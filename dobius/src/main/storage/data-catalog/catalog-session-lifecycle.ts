import type {
  CatalogResult,
  CatalogRootIdentityReader,
  CatalogScanLimits,
  RegisteredCatalogRoot,
  RegisteredCatalogRootProvider
} from './types'
import { closeMetadataScan, type MetadataFileSystem, type MetadataScan } from './metadata-scanner'
import { resolveAuthorizedCatalogRoot, sameRegisteredRoot } from './registered-roots'
import type { CatalogPreviewPrincipal } from './preview-principal'
import type { CatalogPreviewWitness } from './metadata-scanner'
import { emptyCatalogResult } from './catalog-result'
import { runCatalogSessionPage } from './catalog-session-page'

export type ScanSession = {
  principalId: string
  root: RegisteredCatalogRoot
  scan: MetadataScan
  expiresAtMonotonic: number
  expiresAtWall: number
  reservation: object
}

export class CatalogSessionLifecycle {
  readonly sessions = new Map<string, ScanSession>()
  private readonly expiredCursors = new Map<string, { monotonic: number; wall: number }>()
  private readonly reservations = new Set<object>()
  private readonly rootIdentityReader: CatalogRootIdentityReader | undefined

  constructor(
    private readonly roots: RegisteredCatalogRootProvider,
    private readonly limits: CatalogScanLimits,
    private readonly now: () => number,
    private readonly wallClockNow: () => number,
    private readonly fileSystem: MetadataFileSystem
  ) {
    const captureRootIdentity = fileSystem.captureRootIdentity
    this.rootIdentityReader = captureRootIdentity
      ? (path) => captureRootIdentity.call(fileSystem, path)
      : undefined
  }

  reserve(): object | null {
    if (this.reservations.size >= this.limits.maxSessions) {
      return null
    }
    const reservation = {}
    this.reservations.add(reservation)
    return reservation
  }

  takeExpiredCursor(cursor: string): boolean {
    if (!this.expiredCursors.has(cursor)) {
      return false
    }
    this.expiredCursors.delete(cursor)
    return true
  }

  takeSession(cursor: string): ScanSession | undefined {
    const session = this.sessions.get(cursor)
    if (session) {
      this.sessions.delete(cursor)
    }
    return session
  }

  isSessionRetained(session: ScanSession): boolean {
    return [...this.sessions.values()].some((candidate) => candidate === session)
  }

  retain(cursor: string, session: ScanSession): void {
    session.expiresAtMonotonic = this.now() + this.limits.sessionTtlMs
    session.expiresAtWall = this.wallClockNow() + this.limits.sessionTtlMs
    this.sessions.set(cursor, session)
  }

  release(session: ScanSession): void {
    this.reservations.delete(session.reservation)
  }

  releaseReservation(reservation: object): void {
    this.reservations.delete(reservation)
  }

  reservationHasRetainedSession(reservation: object): boolean {
    return [...this.sessions.values()].some((session) => session.reservation === reservation)
  }

  async close(): Promise<void> {
    await Promise.all(Array.from(this.sessions.values(), ({ scan }) => closeMetadataScan(scan)))
    this.sessions.clear()
    this.expiredCursors.clear()
    this.reservations.clear()
  }

  async continue(
    cursor: string,
    session: ScanSession,
    pageSize: number,
    signal?: AbortSignal,
    isClosed: () => boolean = () => false,
    previewPrincipal?: CatalogPreviewPrincipal,
    onPageCommitted?: (
      result: CatalogResult,
      witnesses: ReadonlyMap<string, CatalogPreviewWitness>
    ) => void
  ): Promise<CatalogResult> {
    if (isClosed() || signal?.aborted) {
      await this.drop(cursor, session)
      return emptyCatalogResult('unavailable', 'cancelled')
    }
    if (this.isExpired(session)) {
      await this.drop(cursor, session)
      this.rememberExpiredCursor(cursor)
      return emptyCatalogResult('unavailable', 'expired')
    }
    const authorization = await resolveAuthorizedCatalogRoot(
      this.roots,
      session.principalId,
      session.root.id,
      signal,
      this.limits.maxElapsedMs,
      this.rootIdentityReader
    )
    if (
      authorization.state !== 'authorized' ||
      !sameRegisteredRoot(session.root, authorization.root)
    ) {
      await this.drop(cursor, session)
      return emptyCatalogResult(
        authorization.state === 'denied' ? 'denied' : 'unavailable',
        authorization.state === 'denied'
          ? 'access_denied'
          : authorization.state === 'changed' || authorization.state === 'authorized'
            ? 'root_changed'
            : 'root_unavailable'
      )
    }
    if (this.isExpired(session)) {
      await this.drop(cursor, session)
      this.rememberExpiredCursor(cursor)
      return emptyCatalogResult('unavailable', 'expired')
    }
    return this.runPage(session, pageSize, signal, isClosed, previewPrincipal, onPageCommitted)
  }

  async runPage(
    session: ScanSession,
    pageSize: number,
    signal?: AbortSignal,
    isClosed: () => boolean = () => false,
    previewPrincipal?: CatalogPreviewPrincipal,
    onPageCommitted?: (
      result: CatalogResult,
      witnesses: ReadonlyMap<string, CatalogPreviewWitness>
    ) => void
  ): Promise<CatalogResult> {
    return runCatalogSessionPage({
      session,
      pageSize,
      signal,
      isClosed,
      limits: this.limits,
      now: this.now,
      wallClockNow: this.wallClockNow,
      fileSystem: this.fileSystem,
      operations: {
        release: (value) => this.release(value),
        retain: (cursorValue, value) => this.retain(cursorValue, value),
        drop: (cursorValue, value) => this.drop(cursorValue, value),
        enforceResponseLimit: (result) => this.enforceResponseLimit(result),
        commitPage: (result, witnesses, principal, callback) =>
          this.commitPage(result, witnesses, principal, callback),
        authorizeAfterScan: async () => {
          const authorization = await resolveAuthorizedCatalogRoot(
            this.roots,
            session.principalId,
            session.root.id,
            signal,
            this.limits.maxElapsedMs,
            this.rootIdentityReader
          )
          if (
            authorization.state === 'authorized' &&
            sameRegisteredRoot(session.root, authorization.root)
          ) {
            return null
          }
          return emptyCatalogResult(
            authorization.state === 'denied' ? 'denied' : 'unavailable',
            authorization.state === 'denied'
              ? 'access_denied'
              : authorization.state === 'changed' || authorization.state === 'authorized'
                ? 'root_changed'
                : 'root_unavailable'
          )
        }
      },
      previewPrincipal,
      onPageCommitted
    })
  }

  private commitPage(
    result: CatalogResult,
    witnesses: ReadonlyMap<string, CatalogPreviewWitness>,
    principal?: CatalogPreviewPrincipal,
    callback?: (
      result: CatalogResult,
      witnesses: ReadonlyMap<string, CatalogPreviewWitness>
    ) => void
  ): CatalogResult {
    if (!principal || !callback || (result.state !== 'partial' && result.state !== 'complete')) {
      return result
    }
    const entries = new Set(result.entries.map((entry) => entry.entryId))
    callback(result, new Map([...witnesses].filter(([entryId]) => entries.has(entryId))))
    return result
  }

  async expireSessions(): Promise<void> {
    const now = this.now()
    const wallNow = this.wallClockNow()
    const expired: Promise<void>[] = []
    for (const [cursor, session] of this.sessions) {
      if (session.expiresAtMonotonic <= now || session.expiresAtWall <= wallNow) {
        expired.push(closeMetadataScan(session.scan))
        this.release(session)
        this.sessions.delete(cursor)
        this.rememberExpiredCursor(cursor)
      }
    }
    for (const [cursor, expiresAt] of this.expiredCursors) {
      if (expiresAt.monotonic <= now || expiresAt.wall <= wallNow) {
        this.expiredCursors.delete(cursor)
      }
    }
    await Promise.all(expired)
  }

  private enforceResponseLimit(result: CatalogResult): CatalogResult {
    return Buffer.byteLength(JSON.stringify(result)) <= this.limits.maxResponseBytes
      ? result
      : emptyCatalogResult('unavailable', 'response_limit')
  }

  private rememberExpiredCursor(cursor: string): void {
    this.expiredCursors.set(cursor, {
      monotonic: this.now() + this.limits.sessionTtlMs,
      wall: this.wallClockNow() + this.limits.sessionTtlMs
    })
    while (this.expiredCursors.size > this.limits.maxSessions * 2) {
      const oldest = this.expiredCursors.keys().next().value
      if (!oldest) {
        break
      }
      this.expiredCursors.delete(oldest)
    }
  }

  async drop(cursor: string, session: ScanSession): Promise<void> {
    this.sessions.delete(cursor)
    this.release(session)
    await closeMetadataScan(session.scan)
  }

  private isExpired(session: ScanSession): boolean {
    // Wall time catches suspend gaps; monotonic time prevents a wall-clock rollback extending TTL.
    return session.expiresAtMonotonic <= this.now() || session.expiresAtWall <= this.wallClockNow()
  }
}
