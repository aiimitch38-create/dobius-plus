import { randomBytes } from 'node:crypto'
import {
  DataCatalogPreviewPolicyRequestSchema,
  DataCatalogPreviewPolicyResultSchema,
  DataCatalogPreviewResolveRequestSchema,
  DataCatalogPreviewResolveResultSchema,
  DataCatalogSetPreviewAccessRequestSchema
} from '../../../shared/data-catalog-preview-schema'
import { parseNativePreviewStat, type NativePreviewStat } from './descriptor-preview-contract'
import {
  isLivePreviewPrincipal,
  catalogPreviewPrincipalKey,
  type CatalogPreviewPrincipal
} from './preview-principal'
import { CatalogPreviewLifecycleOperations } from './catalog-preview-service-lifecycle'
import type { CatalogPreviewWitness } from './metadata-scanner'
import type { CatalogResult } from './types'
import type { DataCatalogRootEnrollmentStore } from './root-enrollment-store'
import {
  failure,
  isPreviewableWitness,
  LISTED_TTL_MS,
  MAX_REFS_GLOBAL,
  MAX_REFS_PER_PRINCIPAL,
  MAX_WITNESSES_GLOBAL,
  MAX_WITNESSES_PER_CONNECTION,
  REFERENCE_TTL_MS,
  sameStat,
  witnessKey
} from './catalog-preview-service-state'

/** Main-only, bounded preview facade. Operations are split by lifecycle responsibility. */
export class CatalogPreviewSessionService extends CatalogPreviewLifecycleOperations {
  registerEmittedPage(
    principal: CatalogPreviewPrincipal,
    result: CatalogResult,
    pageWitnesses: ReadonlyMap<string, CatalogPreviewWitness>
  ): void {
    if (
      this.closed ||
      !isLivePreviewPrincipal(principal) ||
      result.rootId === null ||
      (result.state !== 'partial' && result.state !== 'complete')
    ) {
      return
    }
    const firstWitness = [...pageWitnesses.values()].find((item) => item.rootId === result.rootId)
    if (!firstWitness) {
      return
    }
    let registration: ReturnType<DataCatalogRootEnrollmentStore['previewRegistration']>
    try {
      registration = this.options.roots.previewRegistration(result.rootId)
    } catch {
      return
    }
    if (!registration || registration.root.generation !== firstWitness.generation) {
      return
    }
    const ticket = this.options.authority.capture(principal)
    const helperEpoch = this.helperEpoch()
    if (!ticket || helperEpoch === null || !this.hasNativeCapability()) {
      return
    }
    this.expire()
    const principalKey = catalogPreviewPrincipalKey(principal)
    const emitted = new Set(result.entries.map((entry) => entry.entryId))
    for (const entryId of emitted) {
      const witness = pageWitnesses.get(entryId)
      if (
        !witness ||
        witness.entryId !== entryId ||
        witness.rootId !== result.rootId ||
        witness.generation !== registration.root.generation ||
        !isPreviewableWitness(witness)
      ) {
        continue
      }
      const key = witnessKey(
        principal.connectionId,
        result.rootId,
        registration.root.generation,
        entryId
      )
      this.witnesses.delete(key)
      if (this.connectionWitnessCount(principal.connectionId) >= MAX_WITNESSES_PER_CONNECTION) {
        break
      }
      if (this.witnesses.size >= MAX_WITNESSES_GLOBAL) {
        break
      }
      this.witnesses.set(key, {
        principalId: principal.principalId,
        principalKey,
        connectionId: principal.connectionId,
        ticket,
        root: registration.root,
        witness,
        helperEpoch,
        expiresAt: this.now() + LISTED_TTL_MS,
        expiresAtWall: this.wallNow() + LISTED_TTL_MS
      })
    }
  }

  async policy(principal: CatalogPreviewPrincipal, input: unknown) {
    const request = DataCatalogPreviewPolicyRequestSchema.safeParse(input)
    if (!request.success || this.closed || !isLivePreviewPrincipal(principal)) {
      return { state: 'denied' } as const
    }
    const ticket = this.options.authority.capture(principal)
    if (!ticket) {
      return { state: 'denied' } as const
    }
    let registration: ReturnType<DataCatalogRootEnrollmentStore['previewRegistration']>
    try {
      registration = this.options.roots.previewRegistration(request.data.rootId)
    } catch {
      return { state: 'unavailable' } as const
    }
    if (!registration || registration.root.generation !== request.data.generation) {
      return { state: 'denied' } as const
    }
    if (!this.reserveOperation()) {
      return { state: 'unavailable' } as const
    }
    try {
      const authorization = await this.authorize(principal, ticket, registration.root, false)
      if (!authorization) {
        return { state: 'denied' } as const
      }
      if (!this.isTicketCurrent(ticket, principal, registration.root, false)) {
        return { state: 'denied' } as const
      }
      if (principal.kind === 'local-webcontents') {
        const devices = this.options
          .pairedDevices()
          .filter((device) => device.scope === 'mobile')
          .slice(0, 64)
          .map(({ deviceId, name }) => ({ deviceId, name }))
        const paired = new Set(devices.map((device) => device.deviceId))
        const allowed = registration.allowedPreviewDeviceIds.filter((id) => paired.has(id))
        return DataCatalogPreviewPolicyResultSchema.parse({
          state: 'local',
          desktopPreviewEnabled: registration.desktopPreviewEnabled,
          deviceIds: allowed,
          devices
        })
      }
      if (principal.kind === 'paired-mobile') {
        return DataCatalogPreviewPolicyResultSchema.parse({
          state: 'mobile',
          enabled: registration.allowedPreviewDeviceIds.includes(principal.deviceId)
        })
      }
      return { state: 'denied' } as const
    } catch {
      return { state: 'unavailable' } as const
    } finally {
      this.releaseOperation()
    }
  }

  setAccess(input: unknown) {
    const request = DataCatalogSetPreviewAccessRequestSchema.safeParse(input)
    if (!request.success || this.closed) {
      throw new Error('Preview access request is invalid')
    }
    const result = this.options.roots.setPreviewAccess(
      request.data.rootId,
      request.data.desktopPreviewEnabled,
      request.data.deviceIds
    )
    this.invalidateRoot(request.data.rootId, 'revoked')
    return result
  }

  async resolve(principal: CatalogPreviewPrincipal, input: unknown) {
    const request = DataCatalogPreviewResolveRequestSchema.safeParse(input)
    if (!request.success || this.closed || !isLivePreviewPrincipal(principal)) {
      return failure('denied')
    }
    this.expire()
    const ticket = this.options.authority.capture(principal)
    if (!ticket) {
      return failure('denied')
    }
    let registration: ReturnType<DataCatalogRootEnrollmentStore['previewRegistration']>
    try {
      registration = this.options.roots.previewRegistration(request.data.rootId)
    } catch {
      return failure('unavailable')
    }
    if (!registration || registration.root.generation !== request.data.generation) {
      return failure('denied')
    }
    if (!this.hasNativeCapability() || this.helperEpoch() === null) {
      return failure('unavailable')
    }
    if (!this.reserveOperation()) {
      return failure('busy')
    }
    if (!this.beginNative()) {
      this.releaseOperation()
      return failure('busy')
    }
    try {
      const authorized = await this.authorize(principal, ticket, registration.root)
      if (!authorized) {
        return failure('denied')
      }
      const key = witnessKey(
        principal.connectionId,
        request.data.rootId,
        request.data.generation,
        request.data.entryId
      )
      const witness = this.witnesses.get(key)
      if (
        !witness ||
        witness.principalKey !== ticket.principalKey ||
        witness.principalId !== principal.principalId ||
        !this.isCurrent(witness, principal)
      ) {
        return failure('expired')
      }
      let currentStat: NativePreviewStat
      try {
        currentStat = parseNativePreviewStat(
          await this.withVerifiedRoot(
            principal,
            ticket,
            witness.root,
            witness.helperEpoch,
            (root, handle) =>
              this.options.fileSystem!.statPreview!(root, handle, witness.witness.components)
          )
        )
      } catch (error) {
        return failure(this.failureFor(error))
      }
      const currentRoot = await this.authorize(principal, ticket, witness.root)
      if (
        !currentRoot ||
        this.witnesses.get(key) !== witness ||
        !this.isCurrent(witness, principal)
      ) {
        return failure('denied')
      }
      if (!sameStat(currentStat, witness.witness.stat)) {
        this.witnesses.delete(key)
        return failure('changed')
      }
      if (
        this.referenceCount(ticket.principalKey) >= MAX_REFS_PER_PRINCIPAL ||
        this.references.size >= MAX_REFS_GLOBAL
      ) {
        return failure('busy')
      }
      const entryRef = randomBytes(32).toString('base64url')
      this.references.set(entryRef, {
        ...witness,
        expiresAt: this.now() + REFERENCE_TTL_MS,
        expiresAtWall: this.wallNow() + REFERENCE_TTL_MS
      })
      return DataCatalogPreviewResolveResultSchema.parse({
        state: 'ready',
        entryRef,
        rootId: witness.root.id,
        generation: witness.root.generation,
        fileVersion: witness.witness.stat.fileVersion,
        sizeBytes: witness.witness.stat.sizeBytes,
        expiresInMs: REFERENCE_TTL_MS
      })
    } finally {
      this.activeNative -= 1
      this.releaseOperation()
    }
  }
}
