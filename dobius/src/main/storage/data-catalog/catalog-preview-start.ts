import { randomUUID } from 'node:crypto'
import {
  DataCatalogPreviewStartResultSchema,
  DataCatalogPreviewStartRequestSchema
} from '../../../shared/data-catalog-preview-schema'
import {
  DESCRIPTOR_PREVIEW_MAX_CHUNK_BYTES,
  DESCRIPTOR_PREVIEW_MAX_FILE_BYTES,
  parseNativePreviewStat
} from './descriptor-preview-contract'
import {
  isLivePreviewPrincipal,
  catalogPreviewPrincipalKey,
  type CatalogPreviewPrincipal
} from './preview-principal'
import { CatalogPreviewServiceMaintenance } from './catalog-preview-service-maintenance'
import {
  failure,
  MAX_SESSIONS_GLOBAL,
  MAX_SESSIONS_PER_PRINCIPAL,
  sameRoot,
  sameStat,
  SESSION_TTL_MS,
  type PreviewSession
} from './catalog-preview-service-state'

export class CatalogPreviewStartOperations extends CatalogPreviewServiceMaintenance {
  async start(principal: CatalogPreviewPrincipal, input: unknown) {
    const request = DataCatalogPreviewStartRequestSchema.safeParse(input)
    if (!request.success || this.closed || !isLivePreviewPrincipal(principal)) {
      return failure('denied')
    }
    this.expire()
    const reference = this.references.get(request.data.entryRef)
    this.references.delete(request.data.entryRef) // A reference is single-use, including failed attempts.
    if (
      !reference ||
      reference.principalKey !== catalogPreviewPrincipalKey(principal) ||
      !this.isCurrent(reference, principal)
    ) {
      return failure('expired')
    }
    if (
      this.principalSessionCount(reference.principalKey) >= MAX_SESSIONS_PER_PRINCIPAL ||
      this.sessions.size >= MAX_SESSIONS_GLOBAL
    ) {
      return failure('busy')
    }
    const ticket = this.options.authority.capture(principal)
    const helperEpoch = this.helperEpoch()
    if (!ticket || helperEpoch === null) {
      return failure('unavailable')
    }
    if (!this.reserveOperation()) {
      return failure('busy')
    }
    const session: PreviewSession = {
      id: randomUUID(),
      principalId: principal.principalId,
      principalKey: ticket.principalKey,
      connectionId: principal.connectionId,
      ticket,
      helperEpoch,
      root: reference.root,
      components: [...reference.witness.components],
      stat: reference.witness.stat,
      expiresAt: this.now() + SESSION_TTL_MS,
      expiresAtWall: this.wallNow() + SESSION_TTL_MS,
      offset: 0,
      finalChunkSeen: false,
      finishStarted: false,
      visibilityLeaseIssued: false,
      visibleUntil: null,
      visibleUntilWall: null,
      busy: true
    }
    this.sessions.set(session.id, session)
    try {
      if (!this.hasNativeCapability()) {
        return this.removeFailure(session, 'unavailable')
      }
      if (!this.beginNative()) {
        return this.removeFailure(session, 'busy')
      }
      try {
        const authorized = await this.authorize(principal, ticket, session.root)
        if (!authorized) {
          return this.removeFailure(session, 'denied')
        }
        const stat = parseNativePreviewStat(
          await this.withVerifiedRoot(
            principal,
            ticket,
            authorized,
            helperEpoch,
            (root, openedRoot) =>
              this.options.fileSystem!.statPreview!(root, openedRoot, session.components)
          )
        )
        const checked = await this.authorize(principal, ticket, session.root)
        if (!checked || !sameRoot(authorized, checked) || !this.sameHelperEpoch(helperEpoch)) {
          return this.removeFailure(session, 'denied')
        }
        if (!sameStat(stat, session.stat)) {
          return this.removeFailure(session, 'changed')
        }
        if (BigInt(stat.sizeBytes) > BigInt(DESCRIPTOR_PREVIEW_MAX_FILE_BYTES)) {
          return this.removeFailure(session, 'too_large')
        }
        if (!this.isSessionCurrent(session, principal)) {
          return this.removeFailure(session, 'cancelled')
        }
        session.busy = false
        return DataCatalogPreviewStartResultSchema.parse({
          state: 'ready',
          previewSessionId: session.id,
          rootId: session.root.id,
          generation: session.root.generation,
          fileVersion: session.stat.fileVersion,
          totalBytes: session.stat.sizeBytes,
          chunkBytes: DESCRIPTOR_PREVIEW_MAX_CHUNK_BYTES,
          expiresInMs: SESSION_TTL_MS
        })
      } catch (error) {
        return this.removeFailure(session, this.failureFor(error))
      } finally {
        this.activeNative -= 1
      }
    } finally {
      this.releaseOperation()
      if (this.sessions.get(session.id) === session) {
        session.busy = false
      }
    }
  }
}
