import type { CatalogPreviewAuthorityEpoch } from './preview-authority'
import type { DataCatalogPreviewInvalidatedEvent } from '../../../shared/data-catalog-preview-schema'
import type { CatalogPairedDevice } from './application-catalog'
import type { CatalogPreviewWitness, MetadataFileSystem } from './metadata-scanner'
import type { CatalogPreviewAuthorityTicket } from './preview-principal'
import type { DataCatalogRootEnrollmentStore } from './root-enrollment-store'
import type { RegisteredCatalogRoot } from './types'
import type { NativePreviewStat } from './descriptor-preview-contract'

export const LISTED_TTL_MS = 60_000
export const REFERENCE_TTL_MS = 30_000
export const SESSION_TTL_MS = 60_000
export const DISPLAY_LEASE_MS = 30_000
export const MAX_WITNESSES_PER_CONNECTION = 512
export const MAX_WITNESSES_GLOBAL = 2_048
export const MAX_REFS_PER_PRINCIPAL = 16
export const MAX_REFS_GLOBAL = 64
export const MAX_SESSIONS_PER_PRINCIPAL = 1
export const MAX_SESSIONS_GLOBAL = 16
export const MAX_ACTIVE_NATIVE = 4
export const MAX_INFLIGHT_GLOBAL = 16

export type WitnessRecord = {
  principalId: string
  principalKey: string
  connectionId: string
  ticket: CatalogPreviewAuthorityTicket
  root: RegisteredCatalogRoot
  witness: CatalogPreviewWitness
  helperEpoch: string | number
  expiresAt: number
  expiresAtWall: number
}
export type ReferenceRecord = WitnessRecord & { expiresAt: number; expiresAtWall: number }
export type PreviewSession = {
  id: string
  principalId: string
  principalKey: string
  connectionId: string
  ticket: CatalogPreviewAuthorityTicket
  helperEpoch: string | number
  root: RegisteredCatalogRoot
  components: string[]
  stat: NativePreviewStat
  expiresAt: number
  expiresAtWall: number
  offset: number
  finalChunkSeen: boolean
  finishStarted: boolean
  visibilityLeaseIssued: boolean
  visibleUntil: number | null
  visibleUntilWall: number | null
  busy: boolean
}
export type CatalogPreviewServiceOptions = {
  roots: DataCatalogRootEnrollmentStore
  fileSystem?: MetadataFileSystem
  authority: CatalogPreviewAuthorityEpoch
  pairedDevices: () => readonly CatalogPairedDevice[]
  now?: () => number
  wallClockNow?: () => number
  emitInvalidated?: (connectionId: string, event: DataCatalogPreviewInvalidatedEvent) => void
}

export class CatalogPreviewServiceState {
  protected readonly witnesses = new Map<string, WitnessRecord>()
  protected readonly references = new Map<string, ReferenceRecord>()
  protected readonly sessions = new Map<string, PreviewSession>()
  protected readonly now: () => number
  protected readonly wallNow: () => number
  protected inflight = 0
  protected activeNative = 0
  protected closed = false
  protected readonly drainWaiters: (() => void)[] = []

  constructor(protected readonly options: CatalogPreviewServiceOptions) {
    this.now = options.now ?? (() => performance.now())
    this.wallNow = options.wallClockNow ?? Date.now
  }
}

export type PreviewFailure =
  | 'denied'
  | 'unavailable'
  | 'expired'
  | 'changed'
  | 'unsupported'
  | 'unsupported_type'
  | 'too_large'
  | 'busy'
  | 'cancelled'
  | 'incomplete'
  | 'invalid_offset'

export function failure(state: PreviewFailure) {
  return { state } as const
}

export function witnessKey(
  connection: string,
  root: string,
  generation: string,
  entry: string
): string {
  return `${connection}\0${root}\0${generation}\0${entry}`
}

export function isPreviewableWitness(witness: CatalogPreviewWitness): boolean {
  return (
    witness.components.length > 0 &&
    witness.components.every(
      (part) =>
        !!part && part !== '.' && part !== '..' && !part.includes('/') && !part.includes('\0')
    ) &&
    /\.(?:md|txt)$/i.test(witness.components.at(-1) ?? '')
  )
}

export function sameStat(left: NativePreviewStat, right: NativePreviewStat): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.sizeBytes === right.sizeBytes &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.fileType === right.fileType &&
    left.fileVersion === right.fileVersion
  )
}

export function sameRoot(left: RegisteredCatalogRoot, right: RegisteredCatalogRoot): boolean {
  return (
    left.id === right.id &&
    left.generation === right.generation &&
    left.kind === right.kind &&
    left.canonicalPath === right.canonicalPath &&
    left.identity.dev === right.identity.dev &&
    left.identity.ino === right.identity.ino &&
    left.identity.birthtimeNs === right.identity.birthtimeNs &&
    left.identity.incarnation.provider === right.identity.incarnation.provider &&
    left.identity.incarnation.scope === right.identity.incarnation.scope &&
    left.identity.incarnation.token === right.identity.incarnation.token
  )
}

export class PreviewOperationError extends Error {
  constructor(readonly state: PreviewFailure) {
    super(state)
  }
}
