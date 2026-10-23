import { createHash } from 'node:crypto'
import {
  AdamServicePrincipalEnrollmentSchema,
  AdamServicePrincipalPeerSchema,
  AdamServicePrincipalRequestSchema,
  AdamServicePrincipalVerifyInputSchema,
  assertAllowed,
  decodeCredential,
  detachIdentity,
  parseGeneration,
  parseServiceId,
  sameDigest,
  samePeer,
  type AdamServicePrincipalIdentity,
  type AdamServicePrincipalProof
} from './principal-contract'

export type { AdamServicePrincipalIdentity, AdamServicePrincipalProof } from './principal-contract'

/** This adapter is a privileged main-composition input, never a caller identity. */
export type AdamServicePrincipalTrustAdapter = {
  verifyEnrollment(
    identity: AdamServicePrincipalIdentity,
    credentialDigest: string,
    proof: unknown
  ): Promise<boolean>
  verifyTransportPeer(peer: unknown): Promise<unknown>
  verifyRevocation(serviceId: string, expectedGeneration: number, proof: unknown): Promise<boolean>
}

export class AdamServicePrincipalRegistryError extends Error {
  constructor() {
    super('ADAM service principal is unavailable.')
    this.name = 'AdamServicePrincipalRegistryError'
  }
}

type RecordEntry = { identity: AdamServicePrincipalIdentity; credentialDigest: Buffer }
type ProofRecord = { serviceId: string; generation: number }

/** Main-only, memory-only foundation. It is unavailable until trusted adapters are supplied. */
export class AdamServicePrincipalRegistry {
  private readonly entries = new Map<string, RecordEntry>()
  private readonly lastGeneration = new Map<string, number>()
  private readonly proofRecords = new WeakMap<object, ProofRecord>()
  private revision = 0

  private constructor(private readonly trust?: AdamServicePrincipalTrustAdapter) {}

  static unavailable(): AdamServicePrincipalRegistry {
    return new AdamServicePrincipalRegistry()
  }

  /** Only main composition may supply adapters backed by real enrollment and peer authentication. */
  static withTrustedAdapter(trust: AdamServicePrincipalTrustAdapter): AdamServicePrincipalRegistry {
    return new AdamServicePrincipalRegistry(trust)
  }

  async enroll(raw: unknown, enrollmentProof: unknown): Promise<void> {
    try {
      if (!this.trust) {
        throw new AdamServicePrincipalRegistryError()
      }
      const parsed = AdamServicePrincipalEnrollmentSchema.parse(raw)
      const identity = detachIdentity(parsed.identity)
      const credentialBytes = decodeCredential(parsed.credential)
      const digestBytes = createHash('sha256').update(credentialBytes).digest()
      const revision = this.revision
      if (
        !(await this.trust.verifyEnrollment(identity, digestBytes.toString('hex'), enrollmentProof))
      ) {
        throw new AdamServicePrincipalRegistryError()
      }
      if (revision !== this.revision) {
        throw new AdamServicePrincipalRegistryError()
      }
      const previous = this.lastGeneration.get(identity.serviceId) ?? 0
      if (identity.authorizationGeneration <= previous) {
        throw new AdamServicePrincipalRegistryError()
      }
      this.entries.set(identity.serviceId, { identity, credentialDigest: digestBytes })
      this.lastGeneration.set(identity.serviceId, identity.authorizationGeneration)
      this.bumpRevision()
    } catch {
      throw new AdamServicePrincipalRegistryError()
    }
  }

  async verify(raw: unknown): Promise<AdamServicePrincipalProof> {
    try {
      if (!this.trust) {
        throw new AdamServicePrincipalRegistryError()
      }
      const input = AdamServicePrincipalVerifyInputSchema.parse(raw)
      const request = Object.freeze({ ...input.request })
      const credentialDigest = createHash('sha256')
        .update(decodeCredential(input.credential))
        .digest()
      const revision = this.revision
      const peer = AdamServicePrincipalPeerSchema.parse(
        await this.trust.verifyTransportPeer(input.peer)
      )
      if (revision !== this.revision) {
        throw new AdamServicePrincipalRegistryError()
      }
      const entry = this.entries.get(peer.serviceId)
      if (
        !entry ||
        !samePeer(entry.identity, peer) ||
        !sameDigest(entry.credentialDigest, credentialDigest)
      ) {
        throw new AdamServicePrincipalRegistryError()
      }
      assertAllowed(entry.identity, request)
      const proof = Object.freeze({ identity: detachIdentity(entry.identity) })
      this.proofRecords.set(proof, {
        serviceId: peer.serviceId,
        generation: peer.authorizationGeneration
      })
      return proof
    } catch {
      throw new AdamServicePrincipalRegistryError()
    }
  }

  authorize(proof: unknown, rawRequest: unknown): AdamServicePrincipalIdentity {
    try {
      if (!proof || typeof proof !== 'object') {
        throw new AdamServicePrincipalRegistryError()
      }
      const record = this.proofRecords.get(proof)
      if (!record) {
        throw new AdamServicePrincipalRegistryError()
      }
      const request = AdamServicePrincipalRequestSchema.parse(rawRequest)
      const entry = this.entries.get(record.serviceId)
      if (!entry || entry.identity.authorizationGeneration !== record.generation) {
        throw new AdamServicePrincipalRegistryError()
      }
      assertAllowed(entry.identity, request)
      return detachIdentity(entry.identity)
    } catch {
      throw new AdamServicePrincipalRegistryError()
    }
  }

  async revoke(
    serviceIdRaw: unknown,
    expectedGenerationRaw: unknown,
    revocationProof: unknown
  ): Promise<void> {
    try {
      if (!this.trust) {
        throw new AdamServicePrincipalRegistryError()
      }
      const serviceId = parseServiceId(serviceIdRaw)
      const expectedGeneration = parseGeneration(expectedGenerationRaw)
      const revision = this.revision
      const verified = await this.trust.verifyRevocation(
        serviceId,
        expectedGeneration,
        revocationProof
      )
      if (!verified || revision !== this.revision) {
        throw new AdamServicePrincipalRegistryError()
      }
      const entry = this.entries.get(serviceId)
      if (!entry || entry.identity.authorizationGeneration !== expectedGeneration) {
        throw new AdamServicePrincipalRegistryError()
      }
      this.entries.delete(serviceId)
      this.bumpRevision()
    } catch {
      throw new AdamServicePrincipalRegistryError()
    }
  }

  private bumpRevision(): void {
    if (this.revision >= Number.MAX_SAFE_INTEGER) {
      this.entries.clear()
      throw new AdamServicePrincipalRegistryError()
    }
    this.revision += 1
  }
}
