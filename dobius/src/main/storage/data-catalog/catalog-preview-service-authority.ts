import { sameIdentity } from './metadata-directory-traversal'
import {
  catalogPreviewPrincipalKey,
  type CatalogPreviewAuthorityTicket,
  type CatalogPreviewPrincipal
} from './preview-principal'
import type { MetadataDirectoryHandle } from './metadata-scanner'
import type { RegisteredCatalogRoot } from './types'
import type { DataCatalogRootEnrollmentStore } from './root-enrollment-store'
import {
  CatalogPreviewServiceState,
  MAX_ACTIVE_NATIVE,
  MAX_INFLIGHT_GLOBAL,
  PreviewOperationError,
  sameRoot,
  type PreviewSession,
  type WitnessRecord
} from './catalog-preview-service-state'

export class CatalogPreviewServiceAuthority extends CatalogPreviewServiceState {
  protected async authorize(
    principal: CatalogPreviewPrincipal,
    ticket: CatalogPreviewAuthorityTicket,
    root: RegisteredCatalogRoot,
    requirePreview = true
  ): Promise<RegisteredCatalogRoot | null> {
    if (!this.isTicketCurrent(ticket, principal, root, requirePreview)) {
      return null
    }
    let current: RegisteredCatalogRoot | null
    try {
      current = await this.options.roots.resolveAuthorizedRoot(
        principal.principalId,
        root.id,
        principal.signal
      )
    } catch {
      return null
    }
    if (
      !current ||
      !sameRoot(root, current) ||
      !this.isTicketCurrent(ticket, principal, root, requirePreview)
    ) {
      return null
    }
    const registration = this.options.roots.previewRegistration(root.id)
    if (
      !registration ||
      !sameRoot(root, registration.root) ||
      (principal.kind === 'paired-mobile' && !this.isPairedMobile(principal.deviceId)) ||
      (requirePreview && !this.previewGrant(principal, registration))
    ) {
      return null
    }
    return current
  }

  protected isTicketCurrent(
    ticket: CatalogPreviewAuthorityTicket,
    principal: CatalogPreviewPrincipal,
    root: RegisteredCatalogRoot,
    requirePreview = true
  ): boolean {
    try {
      if (
        !this.options.authority.isCurrent(ticket, principal) ||
        (requirePreview && this.helperEpoch() === null)
      ) {
        return false
      }
      const current = this.options.roots.previewRegistration(root.id)
      return (
        !!current &&
        sameRoot(current.root, root) &&
        (principal.kind !== 'paired-mobile' || this.isPairedMobile(principal.deviceId)) &&
        (!requirePreview || this.previewGrant(principal, current))
      )
    } catch {
      return false
    }
  }

  protected previewGrant(
    principal: CatalogPreviewPrincipal,
    registration: NonNullable<ReturnType<DataCatalogRootEnrollmentStore['previewRegistration']>>
  ): boolean {
    if (principal.kind === 'local-webcontents') {
      return registration.desktopPreviewEnabled
    }
    return (
      principal.scope === 'mobile' &&
      this.isPairedMobile(principal.deviceId) &&
      registration.allowedPreviewDeviceIds.includes(principal.deviceId)
    )
  }

  protected isPairedMobile(deviceId: string): boolean {
    return this.options
      .pairedDevices()
      .some((device) => device.deviceId === deviceId && device.scope === 'mobile')
  }

  protected getSession(principal: CatalogPreviewPrincipal, id: string): PreviewSession | null {
    const session = this.sessions.get(id)
    if (
      !session ||
      session.principalKey !== catalogPreviewPrincipalKey(principal) ||
      session.principalId !== principal.principalId ||
      !this.isSessionCurrent(session, principal)
    ) {
      return null
    }
    return session
  }

  protected isSessionCurrent(session: PreviewSession, principal: CatalogPreviewPrincipal): boolean {
    return (
      this.sessions.get(session.id) === session &&
      this.isTicketCurrent(session.ticket, principal, session.root) &&
      this.sameHelperEpoch(session.helperEpoch) &&
      this.sessionNotExpired(session)
    )
  }

  protected isCurrent(record: WitnessRecord, principal: CatalogPreviewPrincipal): boolean {
    return (
      this.options.authority.isCurrent(record.ticket, principal) &&
      this.sameHelperEpoch(record.helperEpoch) &&
      this.now() < record.expiresAt &&
      this.wallNow() < record.expiresAtWall &&
      record.principalKey === catalogPreviewPrincipalKey(principal) &&
      record.principalId === principal.principalId
    )
  }

  protected sessionNotExpired(session: PreviewSession): boolean {
    return session.expiresAt > this.now() && session.expiresAtWall > this.wallNow()
  }

  protected leaseCurrent(session: PreviewSession): boolean {
    return (
      session.visibleUntil !== null &&
      session.visibleUntilWall !== null &&
      session.visibleUntil > this.now() &&
      session.visibleUntilWall > this.wallNow()
    )
  }

  protected helperEpoch(): string | number | null {
    try {
      const value = this.options.fileSystem?.previewHelperEpoch?.()
      return typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))
        ? value
        : null
    } catch {
      return null
    }
  }

  protected sameHelperEpoch(expected: string | number): boolean {
    return this.helperEpoch() === expected
  }

  protected hasNativeCapability(): boolean {
    return (
      !!this.options.fileSystem?.supportsRaceSafeDirectoryHandles &&
      typeof this.options.fileSystem.statPreview === 'function' &&
      typeof this.options.fileSystem.readPreviewChunk === 'function' &&
      typeof this.options.fileSystem.previewHelperEpoch === 'function'
    )
  }

  protected beginNative(): boolean {
    if (this.activeNative >= MAX_ACTIVE_NATIVE || this.inflight > MAX_INFLIGHT_GLOBAL) {
      return false
    }
    this.activeNative += 1
    return true
  }

  protected reserveOperation(): boolean {
    if (this.inflight >= MAX_INFLIGHT_GLOBAL) {
      return false
    }
    this.inflight += 1
    return true
  }

  protected releaseOperation(): void {
    this.inflight -= 1
    if (this.inflight === 0) {
      for (const resolve of this.drainWaiters.splice(0)) {
        resolve()
      }
    }
  }

  protected async withVerifiedRoot<T>(
    principal: CatalogPreviewPrincipal,
    ticket: CatalogPreviewAuthorityTicket,
    root: RegisteredCatalogRoot,
    helperEpoch: string | number,
    operation: (
      authorizedRoot: RegisteredCatalogRoot,
      handle: MetadataDirectoryHandle
    ) => Promise<T>
  ): Promise<T> {
    const fileSystem = this.options.fileSystem
    if (!fileSystem || !this.hasNativeCapability()) {
      throw new PreviewOperationError('unavailable')
    }
    let handle: MetadataDirectoryHandle | null = null
    let result!: T
    let error: unknown
    try {
      handle = await fileSystem.openRoot(root)
      if (!this.sameHelperEpoch(helperEpoch)) {
        throw new PreviewOperationError('denied')
      }
      if (
        !sameIdentity(handle.identity, root.identity) ||
        !this.isTicketCurrent(ticket, principal, root)
      ) {
        throw new PreviewOperationError('changed')
      }
      const rootVerified = await fileSystem.verifyRoot(root, handle)
      if (
        !rootVerified ||
        !this.isTicketCurrent(ticket, principal, root) ||
        !this.sameHelperEpoch(helperEpoch)
      ) {
        throw new PreviewOperationError('denied')
      }
      result = await operation(root, handle)
      if (!this.isTicketCurrent(ticket, principal, root) || !this.sameHelperEpoch(helperEpoch)) {
        throw new PreviewOperationError('denied')
      }
    } catch (caught) {
      error = caught
    }
    if (handle) {
      try {
        await handle.close()
      } catch (caught) {
        error ??= caught
      }
    }
    // Close may yield; check main-owned and helper authority again after it settles.
    if (error) {
      throw error
    }
    if (!this.isTicketCurrent(ticket, principal, root) || !this.sameHelperEpoch(helperEpoch)) {
      throw new PreviewOperationError('denied')
    }
    return result
  }
}
