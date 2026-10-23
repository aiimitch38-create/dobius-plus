import { canonicalCloudJobAdamSha256 } from '../../shared/cloud-job-adam-receipts'
import { CloudJobAdamBindingGrant } from '../../shared/cloud-job-adam-receipts'
import {
  AdamSealApprovedIntentRequest,
  AdamSealApprovedIntentResponse,
  AdamLookupApprovedIntentRequest,
  AdamLookupApprovedIntentResponse,
  AdamSubmitApprovedIntentRequest,
  AdamSubmitApprovedIntentResponse,
  detachAdamIdentity,
  sameAdamGrantIdentity
} from '../../shared/cloud-job-adam-intent-wire'
import type { CloudJobService } from '../automations/cloud-job-service'
import type { CloudJobAdamIntentSealer } from '../automations/cloud-jobs/cloud-job-adam-intent-sealer'
import type { CloudJobAdamIntentUnsealer } from '../automations/cloud-jobs/cloud-job-adam-intent-unsealer'
import type { AdamServicePrincipalRegistry } from './registry'

export class AdamCloudIntentBridgeError extends Error {
  constructor() {
    super('ADAM cloud intent request was refused.')
    this.name = 'AdamCloudIntentBridgeError'
  }
}

export type AdamCloudIntentBridgeOptions = {
  registry: AdamServicePrincipalRegistry
  sealer: CloudJobAdamIntentSealer
  unsealer: CloudJobAdamIntentUnsealer
  runtimeId: () => string
  cloudJobs: () => CloudJobService | undefined
}

/** Main-process composition only. A transport peer and enrollment are required for any effect. */
export class AdamCloudIntentBridge {
  private generation = 0
  private disposed = false

  constructor(private readonly options: AdamCloudIntentBridgeOptions) {}

  async seal(raw: unknown, peerEvidence: unknown): Promise<unknown> {
    const generation = this.generation
    try {
      this.assertLive(generation)
      const request = AdamSealApprovedIntentRequest.parse(raw)
      const envelope = Object.freeze({
        ...request.envelope,
        identity: detachAdamIdentity(request.envelope.identity)
      })
      const auth = this.authorizationRequest(
        request.audienceRuntimeId,
        'adam.sealApprovedIntent',
        envelope.identity.projectId,
        envelope.intentId
      )
      const proof = await this.options.registry.verify({
        peer: peerEvidence,
        credential: request.credential,
        request: auth
      })
      this.authorizeProof(proof, auth, envelope.identity.adamInstanceId)
      const sealedEnvelope = await this.options.sealer.seal(envelope)
      this.authorizeProof(proof, auth, envelope.identity.adamInstanceId)
      this.assertLive(generation)
      const response = AdamSealApprovedIntentResponse.parse({
        schemaVersion: 1,
        audienceRuntimeId: auth.audienceRuntimeId,
        intentId: envelope.intentId,
        identity: envelope.identity,
        sealedEnvelope
      })
      return Object.freeze({ ...response, identity: detachAdamIdentity(response.identity) })
    } catch {
      throw new AdamCloudIntentBridgeError()
    }
  }

  async submit(raw: unknown, peerEvidence: unknown): Promise<unknown> {
    const generation = this.generation
    try {
      this.assertLive(generation)
      const request = AdamSubmitApprovedIntentRequest.parse(raw)
      const identity = detachAdamIdentity(request.identity)
      const approvedJob = Object.freeze({
        ...request.approvedJob,
        dependencies: Object.freeze([...request.approvedJob.dependencies])
      })
      const input = Object.freeze({ ...approvedJob, dependencies: [...approvedJob.dependencies] })
      if (
        identity.projectId !== input.projectId ||
        identity.requestFingerprint !== canonicalCloudJobAdamSha256(input)
      ) {
        throw new AdamCloudIntentBridgeError()
      }
      const auth = this.authorizationRequest(
        request.audienceRuntimeId,
        'adam.submitApprovedIntent',
        identity.projectId,
        request.intentId
      )
      const proof = await this.options.registry.verify({
        peer: peerEvidence,
        credential: request.credential,
        request: auth
      })
      this.authorizeProof(proof, auth, identity.adamInstanceId)
      const recovered = await this.options.unsealer.unseal({
        schemaVersion: 1,
        intentId: request.intentId,
        identity,
        sealedEnvelope: request.sealedEnvelope
      })
      this.authorizeProof(proof, auth, identity.adamInstanceId)
      this.assertLive(generation)
      if (
        recovered.intentId !== request.intentId ||
        !sameAdamGrantIdentity(recovered.grant, identity)
      ) {
        throw new AdamCloudIntentBridgeError()
      }
      const jobs = this.options.cloudJobs()
      if (!jobs) {
        throw new AdamCloudIntentBridgeError()
      }
      const job = await jobs.submitAdamBoundForVerifiedAdam(
        input,
        CloudJobAdamBindingGrant.parse(recovered.grant),
        () => {
          this.assertLive(generation)
          this.authorizeProof(proof, auth, identity.adamInstanceId)
        }
      )
      this.authorizeProof(proof, auth, identity.adamInstanceId)
      this.assertLive(generation)
      const response = AdamSubmitApprovedIntentResponse.parse({
        schemaVersion: 1,
        audienceRuntimeId: auth.audienceRuntimeId,
        intentId: request.intentId,
        identity,
        job
      })
      return Object.freeze({ ...response, identity: detachAdamIdentity(response.identity) })
    } catch {
      throw new AdamCloudIntentBridgeError()
    }
  }

  async lookup(raw: unknown, peerEvidence: unknown): Promise<unknown> {
    const generation = this.generation
    try {
      this.assertLive(generation)
      const request = AdamLookupApprovedIntentRequest.parse(raw)
      const identity = detachAdamIdentity(request.identity)
      const approvedJob = Object.freeze({
        ...request.approvedJob,
        dependencies: Object.freeze([...request.approvedJob.dependencies])
      })
      const input = Object.freeze({ ...approvedJob, dependencies: [...approvedJob.dependencies] })
      if (
        identity.projectId !== input.projectId ||
        identity.requestFingerprint !== canonicalCloudJobAdamSha256(input)
      ) {
        throw new AdamCloudIntentBridgeError()
      }
      const auth = this.authorizationRequest(
        request.audienceRuntimeId,
        'adam.lookupApprovedIntent',
        identity.projectId,
        request.intentId
      )
      const proof = await this.options.registry.verify({
        peer: peerEvidence,
        credential: request.credential,
        request: auth
      })
      this.authorizeProof(proof, auth, identity.adamInstanceId)
      const jobs = this.options.cloudJobs()
      if (!jobs) {
        throw new AdamCloudIntentBridgeError()
      }
      const lookupReader = jobs.prepareAdamBoundChildLookup(identity.projectId)
      const assertExternalCurrent = () => {
        this.assertLive(generation)
        this.authorizeProof(proof, auth, identity.adamInstanceId)
        if (this.options.cloudJobs() !== jobs) {
          throw new AdamCloudIntentBridgeError()
        }
      }
      const assertCurrent = () => {
        assertExternalCurrent()
        lookupReader.assertCurrent(assertExternalCurrent)
      }
      assertCurrent()
      const recovered = await this.options.unsealer.unseal({
        schemaVersion: 1,
        intentId: request.intentId,
        identity,
        sealedEnvelope: request.sealedEnvelope
      })
      assertCurrent()
      if (
        recovered.intentId !== request.intentId ||
        !sameAdamGrantIdentity(recovered.grant, identity)
      ) {
        throw new AdamCloudIntentBridgeError()
      }
      const job = lookupReader.read(
        input,
        CloudJobAdamBindingGrant.parse(recovered.grant),
        assertExternalCurrent
      )
      assertCurrent()
      const response = AdamLookupApprovedIntentResponse.parse({
        schemaVersion: 1,
        audienceRuntimeId: auth.audienceRuntimeId,
        intentId: request.intentId,
        identity,
        job
      })
      return Object.freeze({ ...response, identity: detachAdamIdentity(response.identity) })
    } catch {
      throw new AdamCloudIntentBridgeError()
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.generation += 1
    this.options.sealer.dispose()
    this.options.unsealer.dispose()
  }

  private authorizationRequest(
    audienceRuntimeId: string,
    method: string,
    projectId: string,
    resourceId: string
  ) {
    if (audienceRuntimeId !== this.options.runtimeId()) {
      throw new AdamCloudIntentBridgeError()
    }
    return Object.freeze({ audienceRuntimeId, method, projectId, resourceId })
  }

  private authorizeProof(
    proof: unknown,
    request: ReturnType<AdamCloudIntentBridge['authorizationRequest']>,
    instanceId: string
  ) {
    const identity = this.options.registry.authorize(proof, request)
    if (
      identity.serviceId !== 'adam' ||
      identity.instanceId !== instanceId ||
      identity.audienceRuntimeId !== request.audienceRuntimeId
    ) {
      throw new AdamCloudIntentBridgeError()
    }
    return identity
  }

  private assertLive(generation: number): void {
    if (this.disposed || this.generation !== generation) {
      throw new AdamCloudIntentBridgeError()
    }
  }
}
