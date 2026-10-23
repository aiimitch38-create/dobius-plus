import {
  CatalogOpaqueId,
  CatalogRootId,
  CatalogScanLimitsSchema,
  type CatalogRequest,
  type CatalogResult,
  type CatalogScanLimits,
  type CatalogRootIdentityReader,
  type RegisteredCatalogRootProvider
} from './types'
import { defaultMetadataFileSystem, type MetadataFileSystem } from './metadata-scanner'
import { CatalogSessionLifecycle } from './catalog-session-lifecycle'
import type { CatalogPreviewPrincipal } from './preview-principal'
import type { CatalogPreviewWitness } from './metadata-scanner'
import { emptyCatalogResult } from './catalog-result'
import { startCatalogSessionPage } from './catalog-session-start'

const CursorSchema = CatalogOpaqueId
const RequestSchema = CatalogRootId.transform((rootId) => ({ rootId }))

export class ReadOnlyDataCatalogService {
  private readonly lifecycle: CatalogSessionLifecycle
  private readonly activeControllers = new Set<AbortController>()
  private readonly activePages = new Set<Promise<CatalogResult>>()
  private readonly limits: CatalogScanLimits
  private readonly now: () => number
  private readonly wallClockNow: () => number
  private readonly fileSystem: MetadataFileSystem
  private readonly rootIdentityReader: CatalogRootIdentityReader | undefined
  private closed = false

  constructor(
    private readonly roots: RegisteredCatalogRootProvider,
    options: {
      limits?: Partial<CatalogScanLimits>
      now?: () => number
      wallClockNow?: () => number
      fileSystem?: MetadataFileSystem
    } = {}
  ) {
    this.limits = CatalogScanLimitsSchema.parse(options.limits ?? {})
    this.now = options.now ?? (() => performance.now())
    this.wallClockNow = options.wallClockNow ?? Date.now
    this.fileSystem = options.fileSystem ?? defaultMetadataFileSystem
    const captureRootIdentity = this.fileSystem.captureRootIdentity
    this.rootIdentityReader = captureRootIdentity
      ? (path) => captureRootIdentity.call(this.fileSystem, path)
      : undefined
    this.lifecycle = new CatalogSessionLifecycle(
      roots,
      this.limits,
      this.now,
      this.wallClockNow,
      this.fileSystem
    )
  }

  async page(
    principalInput: string,
    request: CatalogRequest,
    previewPrincipal?: CatalogPreviewPrincipal,
    onPageCommitted?: (
      result: CatalogResult,
      witnesses: ReadonlyMap<string, CatalogPreviewWitness>
    ) => void
  ): Promise<CatalogResult> {
    if (this.closed) {
      return emptyCatalogResult('unavailable', 'cancelled')
    }
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    if (request.signal?.aborted) {
      controller.abort()
    } else {
      request.signal?.addEventListener('abort', forwardAbort, { once: true })
    }
    this.activeControllers.add(controller)
    let timer: NodeJS.Timeout | undefined
    let timeoutResolve: ((value: CatalogResult) => void) | undefined
    const timeoutResult = new Promise<CatalogResult>((resolve) => {
      timeoutResolve = resolve
    })
    timer = setTimeout(() => {
      controller.abort()
      timeoutResolve?.(emptyCatalogResult('unavailable', 'scan_limit'))
    }, this.limits.maxElapsedMs)
    const trustedPrincipal =
      previewPrincipal?.principalId === principalInput ? previewPrincipal : undefined
    const operation = this.pageActive(
      principalInput,
      request,
      controller.signal,
      trustedPrincipal,
      onPageCommitted
    )
    this.activePages.add(operation)
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer)
      }
      request.signal?.removeEventListener('abort', forwardAbort)
      this.activeControllers.delete(controller)
      this.activePages.delete(operation)
    }
    void operation.then(cleanup, cleanup)
    return Promise.race([operation, timeoutResult])
  }

  private async pageActive(
    principalInput: string,
    request: CatalogRequest,
    signal: AbortSignal,
    previewPrincipal?: CatalogPreviewPrincipal,
    onPageCommitted?: (
      result: CatalogResult,
      witnesses: ReadonlyMap<string, CatalogPreviewWitness>
    ) => void
  ): Promise<CatalogResult> {
    const principal = CatalogOpaqueId.safeParse(principalInput)
    const rootInput = RequestSchema.safeParse(request?.rootId)
    if (!principal.success || !rootInput.success) {
      return emptyCatalogResult('denied', 'access_denied')
    }
    const pageSizeResult =
      request.pageSize === undefined
        ? null
        : CatalogScanLimitsSchema.shape.pageSize.safeParse(request.pageSize)
    if (pageSizeResult && !pageSizeResult.success) {
      return emptyCatalogResult('unavailable', 'scan_limit')
    }
    const pageSize = pageSizeResult?.data ?? this.limits.pageSize
    const cursorValue = request.cursor ?? null
    const cursorParsed = cursorValue === null ? null : CursorSchema.safeParse(cursorValue)
    if (cursorValue !== null && !cursorParsed?.success) {
      return emptyCatalogResult('unavailable', 'invalid_cursor')
    }

    await this.lifecycle.expireSessions()
    if (this.closed || signal.aborted) {
      if (cursorValue !== null) {
        const session = this.lifecycle.sessions.get(cursorValue)
        if (
          session &&
          session.principalId === principal.data &&
          session.root.id === rootInput.data.rootId
        ) {
          await this.lifecycle.drop(cursorValue, session)
        }
      }
      return emptyCatalogResult('unavailable', 'cancelled')
    }
    if (cursorValue !== null) {
      if (this.lifecycle.takeExpiredCursor(cursorValue)) {
        return emptyCatalogResult('unavailable', 'expired')
      }
      const session = this.lifecycle.sessions.get(cursorValue)
      if (!session) {
        return emptyCatalogResult('unavailable', 'invalid_cursor')
      }
      if (session.principalId !== principal.data || session.root.id !== rootInput.data.rootId) {
        return emptyCatalogResult('denied', 'access_denied')
      }
      this.lifecycle.takeSession(cursorValue)
      return this.lifecycle.continue(
        cursorValue,
        session,
        pageSize,
        signal,
        () => this.closed,
        previewPrincipal,
        onPageCommitted
      )
    }

    const reservation = this.lifecycle.reserve()
    if (!reservation) {
      return emptyCatalogResult('unavailable', 'scan_limit')
    }
    try {
      return await this.startNewSession(
        principal.data,
        rootInput.data.rootId,
        pageSize,
        signal,
        reservation,
        () => this.closed,
        previewPrincipal,
        onPageCommitted
      )
    } finally {
      if (!this.lifecycle.reservationHasRetainedSession(reservation)) {
        this.lifecycle.releaseReservation(reservation)
      }
    }
  }

  private startNewSession(
    principalId: string,
    rootId: string,
    pageSize: number,
    signal: AbortSignal,
    reservation: object,
    isClosed: () => boolean,
    previewPrincipal?: CatalogPreviewPrincipal,
    onPageCommitted?: (
      result: CatalogResult,
      witnesses: ReadonlyMap<string, CatalogPreviewWitness>
    ) => void
  ): Promise<CatalogResult> {
    return startCatalogSessionPage({
      roots: this.roots,
      limits: this.limits,
      now: this.now,
      wallClockNow: this.wallClockNow,
      fileSystem: this.fileSystem,
      rootIdentityReader: this.rootIdentityReader,
      lifecycle: this.lifecycle,
      principalId,
      rootId,
      pageSize,
      signal,
      reservation,
      isClosed,
      previewPrincipal,
      onPageCommitted
    })
  }

  async close(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled(this.activePages)
      return
    }
    this.closed = true
    for (const controller of this.activeControllers) {
      controller.abort()
    }
    const pages = [...this.activePages]
    await this.lifecycle.close()
    await Promise.allSettled(pages)
  }
}
