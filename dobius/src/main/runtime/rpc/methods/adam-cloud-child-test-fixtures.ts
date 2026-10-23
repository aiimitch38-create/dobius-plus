import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, vi } from 'vitest'
import type { RpcContext } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import { CloudJobService } from '../../../automations/cloud-job-service'
import { CloudJobStore } from '../../../automations/cloud-jobs/store'
import {
  adamBindingResponse,
  adamJobInput
} from '../../../automations/cloud-jobs/cloud-job-adam-client.fixtures'
import { AdamCloudIntentBridge } from '../../../adam-service-principal/adam-cloud-intent-bridge'
import { AdamServicePrincipalRegistry } from '../../../adam-service-principal/registry'
import type { CloudJobAdamSubmissionClient } from '../../../automations/cloud-jobs/cloud-job-adam-client'
import { canonicalCloudJobAdamSha256 } from '../../../../shared/cloud-job-adam-receipts'
import { ADAM_CLOUD_CHILD_METHODS } from './adam-cloud-child'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach((close) => close()))
export const instanceId = '6f5e1f4b-4018-4f39-9d25-cd8124a17211'
export const audienceRuntimeId = '357e37d6-2be7-4c5f-9fc6-9573b3bb8c52'
export const intentId = '25972dbf-17f2-470f-a1f8-2dd205651282'
export const expiresAtMs = Date.now() + 60_000
const boundAtMs = Date.now()
export const credential = Buffer.alloc(32, 7).toString('base64url')
export const sealMethod = 'adam.sealApprovedIntent'
export const submitMethod = 'adam.submitApprovedIntent'
export const lookupMethod = 'adam.lookupApprovedIntent'
export const intentIdentity = (bindingId = intentId) => ({
  ...adamBindingResponse().binding,
  bindingId,
  adamInstanceId: instanceId,
  expiresAtMs
})

export function bindingResponse(bindingId = intentId) {
  const binding = { ...adamBindingResponse().binding, ...intentIdentity(bindingId) }
  return {
    schemaVersion: 1 as const,
    consumed: true as const,
    binding,
    boundAtMs,
    bindingDigest: canonicalCloudJobAdamSha256(binding)
  }
}

export function grant(bindingId = intentId) {
  return { ...intentIdentity(bindingId), capability: 'synthetic-only-capability-value-123456789' }
}

export function sealRequest(requestIntentId = intentId, bindingId = requestIntentId) {
  return {
    schemaVersion: 1,
    audienceRuntimeId,
    credential,
    envelope: {
      schemaVersion: 1,
      intentId: requestIntentId,
      identity: intentIdentity(bindingId),
      capability: grant(bindingId).capability
    }
  }
}

export function submitRequest(
  sealedEnvelope = 'sealed:dobius-adam-intent:v1:YWJjZA==',
  requestIntentId = intentId,
  bindingId = requestIntentId
) {
  return {
    schemaVersion: 1,
    audienceRuntimeId,
    credential,
    intentId: requestIntentId,
    identity: intentIdentity(bindingId),
    sealedEnvelope,
    approvedJob: adamJobInput()
  }
}

export const lookupRequest = submitRequest

export function method(name: string) {
  return ADAM_CLOUD_CHILD_METHODS.find((entry) => entry.name === name)!.handler
}

type FixtureOptions = {
  trusted?: boolean
  consume?: CloudJobAdamSubmissionClient['consumeBinding']
  allowedMethods?: string[]
  requestIntentId?: string
  bindingId?: string
  fileBacked?: boolean
  authorityAvailable?: () => boolean
}

export function fixture({
  trusted = true,
  consume: consumeOverride,
  allowedMethods = [sealMethod, submitMethod],
  requestIntentId = intentId,
  bindingId = requestIntentId,
  fileBacked = false,
  authorityAvailable
}: FixtureOptions = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'adam-composition-')))
  const storePath = fileBacked ? join(root, 'cloud.sqlite') : ':memory:'
  let activeStore = new CloudJobStore(storePath, Date.now, { localDeviceId: 'worker-1' })
  const store = activeStore
  const consume =
    consumeOverride ??
    (async () => ({
      state: 'accepted' as const,
      value: bindingResponse(bindingId)
    }))
  const consumeBinding = vi.fn(consume)
  const service = new CloudJobService({
    openStore: () => activeStore,
    canUseWorkspace: async () => false,
    ...(authorityAvailable ? { authorityAvailable } : {}),
    adamClient: { consumeBinding, consumeBindingForRecovery: consumeBinding }
  })
  let activeService: CloudJobService | undefined = service
  service.registerProject(
    { kind: 'local', id: 'local' },
    { id: 'project-1', deviceId: 'worker-1', root, recipes: ['recipe-1'], capability: 'portable' }
  )
  const runtime = { getRuntimeId: () => audienceRuntimeId } as DobiusRuntimeService
  const proofPeer = Object.freeze({})
  const peer = { serviceId: 'adam', instanceId, audienceRuntimeId, authorizationGeneration: 1 }
  const identity = {
    schemaVersion: 1 as const,
    serviceId: 'adam',
    instanceId,
    audienceRuntimeId,
    authorizationGeneration: 1,
    allowedMethods,
    allowedProjects: ['project-1'],
    allowedResources: allowedMethods.map((method) => ({
      method,
      projectId: 'project-1',
      resourceId: requestIntentId
    }))
  }
  const registry = trusted
    ? AdamServicePrincipalRegistry.withTrustedAdapter({
        verifyEnrollment: async () => true,
        verifyTransportPeer: async (raw) => (raw === proofPeer ? peer : null),
        verifyRevocation: async () => true
      })
    : AdamServicePrincipalRegistry.unavailable()
  const enrollment = trusted ? registry.enroll({ identity, credential }, {}) : Promise.resolve()
  const sealedEnvelope = 'sealed:dobius-adam-intent:v1:YWJjZA=='
  const sealer = {
    seal: vi.fn(async (_envelope: unknown) => sealedEnvelope),
    dispose: vi.fn(),
    invalidate: vi.fn()
  }
  const unsealer = {
    unseal: vi.fn(async () => ({ intentId: requestIntentId, grant: grant(bindingId) })),
    dispose: vi.fn(),
    invalidate: vi.fn()
  }
  const bridge = new AdamCloudIntentBridge({
    registry,
    sealer,
    unsealer,
    runtimeId: () => runtime.getRuntimeId(),
    cloudJobs: () => activeService
  })
  const context: RpcContext = {
    runtime,
    cloudJobs: service,
    adamCloudIntentBridge: bridge,
    adamPeerEvidence: proofPeer,
    authenticatedLocal: true,
    authenticatedLocalSocket: true
  }
  cleanup.push(() => {
    bridge.dispose()
    try {
      service.close()
    } catch {
      // Temporary fixtures may close a replacement store before cleanup runs.
    }
    if (activeStore !== store) {
      try {
        activeStore.close()
      } catch {
        // The service may already have closed the replacement store.
      }
    }
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    store,
    service,
    setCloudJobs(next: CloudJobService | undefined) {
      activeService = next
    },
    consumeBinding,
    runtime,
    proofPeer,
    identity,
    registry,
    enrollment,
    sealedEnvelope,
    storePath,
    replaceStore() {
      service.close()
      activeStore = new CloudJobStore(storePath, Date.now, { localDeviceId: 'worker-1' })
      return activeStore
    },
    sealer,
    unsealer,
    bridge,
    context
  }
}
