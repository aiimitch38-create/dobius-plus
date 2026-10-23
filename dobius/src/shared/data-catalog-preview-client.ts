import {
  DataCatalogPreviewCloseRequestSchema,
  DataCatalogPreviewInvalidatedEventSchema,
  DataCatalogPreviewPolicyRequestSchema,
  DataCatalogPreviewPolicyResultSchema,
  DataCatalogPreviewRenewResultSchema,
  DataCatalogPreviewResolveRequestSchema,
  type DataCatalogPreviewPolicyRequest,
  type DataCatalogPreviewPolicyResult,
  type DataCatalogPreviewResolveRequest
} from './data-catalog-preview-schema'
import {
  dataCatalogPreviewFailureMessage,
  PreviewClientFailure,
  type DataCatalogPreviewClientOptions,
  type DataCatalogPreviewScope,
  type DataCatalogPreviewViewState
} from './data-catalog-preview-client-errors'
import { runCatalogPreviewTransfer } from './data-catalog-preview-transfer'
import { disposePreviewAssembly, type PreviewAssembly } from './data-catalog-preview-assembly'

const PREVIEW_HARD_LEASE_MS = 30_000
const PREVIEW_RENEW_AFTER_MS = 10_000

export type {
  DataCatalogPreviewScope,
  DataCatalogPreviewViewState
} from './data-catalog-preview-client-errors'

export class DataCatalogPreviewClient {
  private readonly now: () => number
  private foreground = true
  private operation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private expiryTimer: ReturnType<typeof setTimeout> | null = null
  private sessionId: string | null = null
  private inFlightAssembly: PreviewAssembly | null = null
  private activeRoot: { rootId: string; generation: string } | null = null
  private visibleDeadline = 0
  private renewedAt = 0
  private state: DataCatalogPreviewViewState = { phase: 'idle' }
  private listeners = new Set<
    (state: DataCatalogPreviewViewState, scope: DataCatalogPreviewScope) => void
  >()

  constructor(private readonly options: DataCatalogPreviewClientOptions) {
    this.now = options.monotonicNow ?? (() => performance.now())
  }

  getState(): DataCatalogPreviewViewState {
    return this.state
  }

  subscribe(
    listener: (state: DataCatalogPreviewViewState, scope: DataCatalogPreviewScope) => void
  ): () => void {
    this.listeners.add(listener)
    listener(this.state, this.activeRoot && { ...this.activeRoot })
    return () => this.listeners.delete(listener)
  }

  /** Returning to foreground never restores text. A new explicit preview call is required. */
  setForeground(active: boolean): void {
    this.foreground = active && this.options.isForeground()
    if (!this.foreground) {
      void this.clear()
    }
  }

  async policy(request: DataCatalogPreviewPolicyRequest): Promise<DataCatalogPreviewPolicyResult> {
    const parsedRequest = DataCatalogPreviewPolicyRequestSchema.safeParse(request)
    if (!parsedRequest.success) {
      return { state: 'unavailable' }
    }
    try {
      const raw = await this.options.rpc('data.catalog.preview.policy', parsedRequest.data)
      const result = DataCatalogPreviewPolicyResultSchema.safeParse(raw)
      return result.success ? result.data : { state: 'unavailable' }
    } catch {
      return { state: 'unavailable' }
    }
  }

  async preview(request: DataCatalogPreviewResolveRequest): Promise<void> {
    await this.clear()
    if (!this.isForeground()) {
      return
    }
    const parsedRequest = DataCatalogPreviewResolveRequestSchema.safeParse(request)
    if (!parsedRequest.success) {
      this.publish({ phase: 'failed', reason: 'This entry is no longer available.' })
      return
    }

    const operation = ++this.operation
    this.visibleDeadline = 0
    this.renewedAt = 0
    this.activeRoot = {
      rootId: parsedRequest.data.rootId,
      generation: parsedRequest.data.generation
    }
    this.publish({ phase: 'loading' })

    try {
      const transfer = await runCatalogPreviewTransfer({
        rpc: this.options.rpc,
        request: parsedRequest.data,
        now: this.now,
        isCurrent: () => this.isCurrent(operation),
        registerSession: (sessionId, fileVersion) => {
          if (!this.isCurrent(operation)) {
            return false
          }
          this.sessionId = sessionId
          this.sessionFileVersion = fileVersion
          return true
        },
        setAssembly: (assembly) => {
          if (operation !== this.operation) {
            if (assembly) {
              disposePreviewAssembly(assembly)
            }
            return
          }
          this.inFlightAssembly = assembly
        }
      })
      if (operation !== this.operation) {
        return
      }
      this.sessionId = transfer.sessionId
      this.sessionFileVersion = transfer.fileVersion
      this.visibleDeadline = transfer.visibleDeadline
      this.renewedAt = transfer.renewedAt
      this.publish({ phase: 'visible', text: transfer.text, deadline: transfer.visibleDeadline })
      this.scheduleLeaseCheck(operation)
    } catch (error) {
      if (operation !== this.operation) {
        return
      }
      const reason = error instanceof PreviewClientFailure ? error.reason : 'unavailable'
      this.publish({ phase: 'failed', reason: dataCatalogPreviewFailureMessage(reason) })
      await this.closeCurrentSession()
    }
  }

  async clear(reason?: string): Promise<void> {
    ++this.operation
    this.cancelTimer()
    this.cancelExpiryTimer()
    const clearedRoot = this.activeRoot && { ...this.activeRoot }
    const sessionId = this.sessionId
    const assembly = this.inFlightAssembly
    this.inFlightAssembly = null
    if (assembly) {
      disposePreviewAssembly(assembly)
    }
    this.sessionId = null
    this.activeRoot = null
    this.visibleDeadline = 0
    this.renewedAt = 0
    this.sessionFileVersion = ''
    this.publish(reason ? { phase: 'failed', reason } : { phase: 'idle' }, clearedRoot)
    if (sessionId) {
      await this.closeSession(sessionId)
    }
  }

  handleInvalidation(raw: unknown): void {
    const event = DataCatalogPreviewInvalidatedEventSchema.safeParse(raw)
    if (!event.success || !this.activeRoot) {
      return
    }
    if (
      event.data.rootId === this.activeRoot.rootId &&
      event.data.generation === this.activeRoot.generation
    ) {
      void this.clear('Preview permission or folder changed. Select Preview again to reload.')
    }
  }

  private isForeground(): boolean {
    return this.foreground && this.options.isForeground()
  }

  private isCurrent(operation: number): boolean {
    return operation === this.operation && this.isForeground()
  }

  private scheduleLeaseCheck(operation: number): void {
    this.cancelTimer()
    this.cancelExpiryTimer()
    const now = this.now()
    if (operation !== this.operation || this.state.phase !== 'visible') {
      return
    }
    if (!this.isForeground() || now >= this.visibleDeadline) {
      void this.clear('Preview expired. Select Preview again to reload.')
      return
    }
    const renewAt = this.renewedAt + PREVIEW_RENEW_AFTER_MS
    this.expiryTimer = setTimeout(
      () => {
        this.expiryTimer = null
        void this.clear('Preview expired. Select Preview again to reload.')
      },
      Math.max(0, this.visibleDeadline - now)
    )
    this.timer = setTimeout(
      () => {
        this.timer = null
        void this.renewOrExpire(operation, renewAt)
      },
      Math.max(0, renewAt - now)
    )
  }

  private async renewOrExpire(operation: number, renewAt: number): Promise<void> {
    if (!this.isCurrent(operation) || this.state.phase !== 'visible') {
      await this.clear('Preview expired. Select Preview again to reload.')
      return
    }
    const current = this.state
    const sessionId = this.sessionId
    if (!sessionId || this.now() >= current.deadline) {
      await this.clear('Preview expired. Select Preview again to reload.')
      return
    }
    if (this.now() < renewAt) {
      this.scheduleLeaseCheck(operation)
      return
    }
    try {
      const renewStartedAt = this.now()
      const resultRaw = await this.options.rpc('data.catalog.preview.renew', {
        previewSessionId: sessionId,
        fileVersion: this.sessionFileVersion
      })
      const result = DataCatalogPreviewRenewResultSchema.safeParse(resultRaw)
      if (!this.isCurrent(operation)) {
        return
      }
      if (!result.success || result.data.state !== 'visible') {
        await this.clear('Preview permission or folder changed. Select Preview again to reload.')
        return
      }
      const proposedDeadline = renewStartedAt + result.data.leaseTtlMs
      const nextDeadline = Math.min(renewStartedAt + PREVIEW_HARD_LEASE_MS, proposedDeadline)
      if (
        this.now() >= current.deadline ||
        this.now() >= proposedDeadline ||
        nextDeadline <= this.now()
      ) {
        await this.clear('Preview expired. Select Preview again to reload.')
        return
      }
      this.cancelExpiryTimer()
      this.visibleDeadline = nextDeadline
      this.renewedAt = this.now()
      this.publish({ ...current, deadline: nextDeadline })
      this.scheduleLeaseCheck(operation)
    } catch {
      if (operation !== this.operation) {
        return
      }
      await this.clear('Preview permission or folder changed. Select Preview again to reload.')
    }
  }

  private sessionFileVersion = ''

  private async closeCurrentSession(): Promise<void> {
    const sessionId = this.sessionId
    this.sessionId = null
    if (sessionId) {
      await this.closeSession(sessionId)
    }
  }

  private async closeSession(previewSessionId: string): Promise<void> {
    const request = DataCatalogPreviewCloseRequestSchema.safeParse({ previewSessionId })
    if (!request.success) {
      return
    }
    try {
      await this.options.rpc('data.catalog.preview.close', request.data)
    } catch {
      // Closing is best-effort; server-side session and lease bounds still expire it.
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
    }
    this.timer = null
  }

  private cancelExpiryTimer(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer)
    }
    this.expiryTimer = null
  }

  private publish(
    state: DataCatalogPreviewViewState,
    scope: DataCatalogPreviewScope = this.activeRoot
  ): void {
    this.state = state
    for (const listener of this.listeners) {
      listener(state, scope && { ...scope })
    }
  }
}
