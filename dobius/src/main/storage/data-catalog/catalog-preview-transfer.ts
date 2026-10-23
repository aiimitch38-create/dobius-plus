import {
  DataCatalogPreviewChunkRequestSchema,
  DataCatalogPreviewChunkResultSchema,
  DataCatalogPreviewFinishRequestSchema,
  DataCatalogPreviewFinishResultSchema,
  DataCatalogPreviewRenewRequestSchema,
  DataCatalogPreviewRenewResultSchema
} from '../../../shared/data-catalog-preview-schema'
import {
  DESCRIPTOR_PREVIEW_MAX_CHUNK_BYTES,
  parseNativePreviewChunk,
  parseNativePreviewStat,
  type NativePreviewStat
} from './descriptor-preview-contract'
import { isLivePreviewPrincipal, type CatalogPreviewPrincipal } from './preview-principal'
import { CatalogPreviewStartOperations } from './catalog-preview-start'
import {
  failure,
  DISPLAY_LEASE_MS,
  MAX_INFLIGHT_GLOBAL,
  PreviewOperationError,
  sameRoot,
  sameStat
} from './catalog-preview-service-state'

export class CatalogPreviewTransferOperations extends CatalogPreviewStartOperations {
  async chunk(principal: CatalogPreviewPrincipal, input: unknown) {
    const request = DataCatalogPreviewChunkRequestSchema.safeParse(input)
    if (!request.success || this.closed || !isLivePreviewPrincipal(principal)) {
      return failure('denied')
    }
    this.expire()
    const session = this.getSession(principal, request.data.previewSessionId)
    if (!session) {
      return failure('expired')
    }
    if (session.busy || this.inflight >= MAX_INFLIGHT_GLOBAL) {
      return failure('busy')
    }
    if (request.data.offset !== session.offset || session.finalChunkSeen) {
      return failure('invalid_offset')
    }
    if (!this.reserveSessionOperation(session)) {
      return failure('busy')
    }
    const ticket = session.ticket
    const helperEpoch = session.helperEpoch
    try {
      if (!this.hasNativeCapability()) {
        return failure('unavailable')
      }
      if (!this.beginNative()) {
        return failure('busy')
      }
      try {
        const authorized = await this.authorize(principal, ticket, session.root)
        if (!authorized) {
          return this.invalidateSession(session, 'denied')
        }
        const nativeChunk = await this.withVerifiedRoot(
          principal,
          ticket,
          session.root,
          helperEpoch,
          async (root, handle) => {
            const stat = parseNativePreviewStat(
              await this.options.fileSystem!.statPreview!(root, handle, session.components)
            )
            if (!sameStat(stat, session.stat)) {
              throw new PreviewOperationError('changed')
            }
            const total = Number(BigInt(session.stat.sizeBytes))
            if (total === 0 && request.data.offset === 0) {
              return { stat, dataBase64: '', offset: 0, nextOffset: 0, final: true }
            }
            if (request.data.offset >= total) {
              throw new PreviewOperationError('invalid_offset')
            }
            const length = Math.min(DESCRIPTOR_PREVIEW_MAX_CHUNK_BYTES, total - request.data.offset)
            return parseNativePreviewChunk(
              await this.options.fileSystem!.readPreviewChunk!(
                root,
                handle,
                session.components,
                session.stat,
                request.data.offset,
                length
              )
            )
          }
        )
        const checked = await this.authorize(principal, ticket, session.root)
        if (
          !checked ||
          !sameRoot(session.root, checked) ||
          !this.isSessionCurrent(session, principal) ||
          !this.sameHelperEpoch(helperEpoch)
        ) {
          return this.invalidateSession(session, 'denied')
        }
        if (
          !sameStat(nativeChunk.stat, session.stat) ||
          nativeChunk.offset !== session.offset ||
          request.data.offset !== session.offset
        ) {
          return this.invalidateSession(session, 'changed')
        }
        // No await follows this check and offset mutation; the returned frame is now committed.
        session.offset = nativeChunk.nextOffset
        session.finalChunkSeen = nativeChunk.final
        return DataCatalogPreviewChunkResultSchema.parse({
          state: 'chunk',
          previewSessionId: session.id,
          rootId: session.root.id,
          generation: session.root.generation,
          fileVersion: session.stat.fileVersion,
          totalBytes: session.stat.sizeBytes,
          offset: nativeChunk.offset,
          nextOffset: nativeChunk.nextOffset,
          final: nativeChunk.final,
          dataBase64: nativeChunk.dataBase64
        })
      } catch (error) {
        return this.invalidateSession(session, this.failureFor(error))
      } finally {
        this.activeNative -= 1
      }
    } finally {
      this.finishSessionOperation(session)
    }
  }

  async finish(principal: CatalogPreviewPrincipal, input: unknown) {
    const request = DataCatalogPreviewFinishRequestSchema.safeParse(input)
    if (!request.success || this.closed || !isLivePreviewPrincipal(principal)) {
      return failure('denied')
    }
    const session = this.getSession(principal, request.data.previewSessionId)
    if (!session) {
      return failure('expired')
    }
    if (session.finishStarted || session.visibilityLeaseIssued || session.visibleUntil !== null) {
      return this.invalidateSession(session, 'expired')
    }
    if (session.busy) {
      return failure('busy')
    }
    if (
      session.finalChunkSeen !== true ||
      session.offset !== Number(BigInt(session.stat.sizeBytes))
    ) {
      return failure('incomplete')
    }
    if (request.data.fileVersion !== session.stat.fileVersion) {
      return this.invalidateSession(session, 'changed')
    }
    const ticket = session.ticket
    if (!this.reserveSessionOperation(session)) {
      return failure('busy')
    }
    if (!this.hasNativeCapability()) {
      this.finishSessionOperation(session)
      return failure('unavailable')
    }
    if (!this.beginNative()) {
      this.finishSessionOperation(session)
      return failure('busy')
    }
    // Set before the first await so this session can never mint a second display lease.
    session.finishStarted = true
    try {
      let currentStat: NativePreviewStat
      try {
        currentStat = parseNativePreviewStat(
          await this.withVerifiedRoot(
            principal,
            ticket,
            session.root,
            session.helperEpoch,
            (root, handle) =>
              this.options.fileSystem!.statPreview!(root, handle, session.components)
          )
        )
      } catch (error) {
        return this.invalidateSession(session, this.failureFor(error))
      }
      const authorized = await this.authorize(principal, ticket, session.root)
      if (
        !authorized ||
        !this.isSessionCurrent(session, principal) ||
        !this.sameHelperEpoch(session.helperEpoch)
      ) {
        return this.invalidateSession(session, 'denied')
      }
      if (!sameStat(currentStat, session.stat)) {
        return this.invalidateSession(session, 'changed')
      }
      // This is the only visibility transition; no await separates its final fence and commit.
      if (
        session.visibilityLeaseIssued ||
        session.visibleUntil !== null ||
        !this.isSessionCurrent(session, principal)
      ) {
        return this.invalidateSession(session, 'denied')
      }
      session.visibilityLeaseIssued = true
      session.visibleUntil = this.now() + DISPLAY_LEASE_MS
      session.visibleUntilWall = this.wallNow() + DISPLAY_LEASE_MS
      return DataCatalogPreviewFinishResultSchema.parse({
        state: 'visible',
        leaseTtlMs: DISPLAY_LEASE_MS
      })
    } finally {
      this.activeNative -= 1
      this.finishSessionOperation(session)
    }
  }

  async renew(principal: CatalogPreviewPrincipal, input: unknown) {
    const request = DataCatalogPreviewRenewRequestSchema.safeParse(input)
    if (!request.success || this.closed || !isLivePreviewPrincipal(principal)) {
      return failure('denied')
    }
    const session = this.getSession(principal, request.data.previewSessionId)
    if (!session || session.visibleUntil === null) {
      return failure('expired')
    }
    if (!this.leaseCurrent(session) || request.data.fileVersion !== session.stat.fileVersion) {
      return this.invalidateSession(session, 'expired')
    }
    if (!this.reserveSessionOperation(session)) {
      return failure('busy')
    }
    if (!this.hasNativeCapability()) {
      this.finishSessionOperation(session)
      return failure('unavailable')
    }
    if (!this.beginNative()) {
      this.finishSessionOperation(session)
      return failure('busy')
    }
    try {
      let currentStat: NativePreviewStat
      try {
        currentStat = parseNativePreviewStat(
          await this.withVerifiedRoot(
            principal,
            session.ticket,
            session.root,
            session.helperEpoch,
            (root, handle) =>
              this.options.fileSystem!.statPreview!(root, handle, session.components)
          )
        )
      } catch (error) {
        return this.invalidateSession(session, this.failureFor(error))
      }
      const authorized = await this.authorize(principal, session.ticket, session.root)
      if (
        !authorized ||
        !this.isSessionCurrent(session, principal) ||
        !this.sameHelperEpoch(session.helperEpoch)
      ) {
        return this.invalidateSession(session, 'denied')
      }
      if (!sameStat(currentStat, session.stat)) {
        return this.invalidateSession(session, 'changed')
      }
      if (!this.leaseCurrent(session) || !this.isSessionCurrent(session, principal)) {
        return this.invalidateSession(session, 'expired')
      }
      session.visibleUntil = this.now() + DISPLAY_LEASE_MS
      session.visibleUntilWall = this.wallNow() + DISPLAY_LEASE_MS
      return DataCatalogPreviewRenewResultSchema.parse({
        state: 'visible',
        leaseTtlMs: DISPLAY_LEASE_MS
      })
    } finally {
      this.activeNative -= 1
      this.finishSessionOperation(session)
    }
  }
}
