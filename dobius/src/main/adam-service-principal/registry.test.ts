import { describe, expect, it, vi } from 'vitest'
import {
  AdamServicePrincipalRegistry,
  AdamServicePrincipalRegistryError,
  type AdamServicePrincipalTrustAdapter
} from './registry'

const credential = Buffer.alloc(32, 7).toString('base64url')
const identity = () => ({
  schemaVersion: 1 as const,
  serviceId: 'adam-primary',
  instanceId: '11111111-1111-4111-8111-111111111111',
  audienceRuntimeId: '22222222-2222-4222-8222-222222222222',
  authorizationGeneration: 1,
  allowedMethods: ['submit', 'unseal'],
  allowedProjects: ['project-a', 'project-b'],
  allowedResources: [
    { method: 'submit', projectId: 'project-a', resourceId: 'job-1' },
    { method: 'unseal', projectId: 'project-b', resourceId: 'intent-1' }
  ]
})
const peer = () => ({
  serviceId: 'adam-primary',
  instanceId: '11111111-1111-4111-8111-111111111111',
  audienceRuntimeId: '22222222-2222-4222-8222-222222222222',
  authorizationGeneration: 1
})
const request = () => ({
  audienceRuntimeId: '22222222-2222-4222-8222-222222222222',
  method: 'submit',
  projectId: 'project-a',
  resourceId: 'job-1'
})
const validEnrollment = () => ({ identity: identity(), credential })
const validVerification = () => ({
  peer: 'verified-transport-handle',
  credential,
  request: request()
})

function fixture(overrides: Partial<AdamServicePrincipalTrustAdapter> = {}) {
  const trust: AdamServicePrincipalTrustAdapter = {
    verifyEnrollment: vi.fn(async () => true),
    verifyTransportPeer: vi.fn(async (raw: unknown) =>
      raw === 'verified-transport-handle' ? peer() : null
    ),
    verifyRevocation: vi.fn(
      async (_serviceId: string, _generation: number, raw: unknown) => raw === 'trusted-revocation'
    ),
    ...overrides
  }
  return { registry: AdamServicePrincipalRegistry.withTrustedAdapter(trust), trust }
}

async function enrolled() {
  const result = fixture()
  await result.registry.enroll(validEnrollment(), 'trusted-enrollment')
  return result
}

function expectFixedRefusal(action: () => unknown): void {
  try {
    action()
    throw new Error('expected refusal')
  } catch (error) {
    expect(error).toBeInstanceOf(AdamServicePrincipalRegistryError)
    expect((error as Error).name).toBe('AdamServicePrincipalRegistryError')
    expect((error as Error).message).toBe('ADAM service principal is unavailable.')
  }
}

describe('AdamServicePrincipalRegistry', () => {
  it('is unavailable without a trusted enrollment and transport adapter', async () => {
    const registry = AdamServicePrincipalRegistry.unavailable()
    await expect(registry.enroll(validEnrollment(), 'proof')).rejects.toMatchObject({
      name: 'AdamServicePrincipalRegistryError',
      message: 'ADAM service principal is unavailable.'
    })
    await expect(registry.verify(validVerification())).rejects.toBeInstanceOf(
      AdamServicePrincipalRegistryError
    )
  })

  it('returns a frozen detached proof only after transport, credential and scope checks', async () => {
    const { registry } = await enrolled()
    const proof = await registry.verify(validVerification())
    const authorized = registry.authorize(proof, request())
    expect(authorized).toEqual(identity())
    expect(Object.isFrozen(proof)).toBe(true)
    expect(Object.isFrozen(authorized.allowedResources)).toBe(true)
    expect(JSON.stringify(proof)).not.toContain(credential)
    expect(() => registry.authorize({ ...proof }, request())).toThrow(
      AdamServicePrincipalRegistryError
    )
  })

  it('does not accept raw peer identity claims without trusted transport verification', async () => {
    const { registry, trust } = await enrolled()
    const rawClaim = { ...peer(), authenticated: true }
    const input = { ...validVerification(), peer: rawClaim }
    await expect(registry.verify(input)).rejects.toBeInstanceOf(AdamServicePrincipalRegistryError)
    expect(trust.verifyTransportPeer).toHaveBeenCalledWith(rawClaim)
  })

  it('rejects incorrect credentials and non-canonical credential bytes', async () => {
    const { registry } = await enrolled()
    await expect(
      registry.verify({
        ...validVerification(),
        credential: Buffer.alloc(32, 8).toString('base64url')
      })
    ).rejects.toBeInstanceOf(AdamServicePrincipalRegistryError)
    await expect(
      registry.verify({ ...validVerification(), credential: `${credential}=` })
    ).rejects.toBeInstanceOf(AdamServicePrincipalRegistryError)
  })

  it.each([
    ['audience', { audienceRuntimeId: '33333333-3333-4333-8333-333333333333' }],
    ['method', { method: 'delete' }],
    ['project', { projectId: 'project-c' }],
    ['resource', { resourceId: 'job-2' }]
  ])('refuses a request with a wrong %s', async (_label, change) => {
    const { registry } = await enrolled()
    const alteredRequest = { ...request(), ...change }
    await expect(
      registry.verify({ ...validVerification(), request: alteredRequest })
    ).rejects.toBeInstanceOf(AdamServicePrincipalRegistryError)
  })

  it('refuses a method/project/resource combination not explicitly enrolled', async () => {
    const { registry } = await enrolled()
    const alteredRequest = { ...request(), method: 'unseal' }
    await expect(
      registry.verify({ ...validVerification(), request: alteredRequest })
    ).rejects.toBeInstanceOf(AdamServicePrincipalRegistryError)
  })

  it('rejects unsorted, duplicated or mutated enrollment data', async () => {
    const { registry, trust } = fixture()
    const enrollment = validEnrollment()
    enrollment.identity.allowedProjects.reverse()
    await expect(registry.enroll(enrollment, 'trusted-enrollment')).rejects.toBeInstanceOf(
      AdamServicePrincipalRegistryError
    )
    expect(trust.verifyEnrollment).not.toHaveBeenCalled()
    const noncanonicalUuid = validEnrollment()
    noncanonicalUuid.identity.instanceId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
    await expect(registry.enroll(noncanonicalUuid, 'trusted-enrollment')).rejects.toBeInstanceOf(
      AdamServicePrincipalRegistryError
    )
    expect(trust.verifyEnrollment).not.toHaveBeenCalled()
  })

  it('detaches enrollment before awaiting its trusted approval', async () => {
    let release!: (accepted: boolean) => void
    const { registry } = fixture({
      verifyEnrollment: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            release = resolve
          })
      )
    })
    const enrollment = validEnrollment()
    const pending = registry.enroll(enrollment, 'trusted-enrollment')
    enrollment.identity.instanceId = '33333333-3333-4333-8333-333333333333'
    release(true)
    await pending
    const proof = await registry.verify(validVerification())
    expect(registry.authorize(proof, request()).instanceId).toBe(
      '11111111-1111-4111-8111-111111111111'
    )
  })

  it('rejects stale generations and proofs after re-enrollment', async () => {
    const { registry, trust } = await enrolled()
    const proof = await registry.verify(validVerification())
    const next = validEnrollment()
    next.identity.authorizationGeneration = 2
    await registry.enroll(next, 'trusted-enrollment')
    expectFixedRefusal(() => registry.authorize(proof, request()))
    trust.verifyTransportPeer = vi.fn(async (raw: unknown) =>
      raw === 'verified-transport-handle' ? { ...peer(), authorizationGeneration: 2 } : null
    )
    const updated = await registry.verify(validVerification())
    expect(registry.authorize(updated, request()).authorizationGeneration).toBe(2)
  })

  it('revocation removes proof authority and rejects stale revocation generations', async () => {
    const { registry } = await enrolled()
    const proof = await registry.verify(validVerification())
    await expect(registry.revoke('adam-primary', 2, 'trusted-revocation')).rejects.toBeInstanceOf(
      AdamServicePrincipalRegistryError
    )
    await registry.revoke('adam-primary', 1, 'trusted-revocation')
    expectFixedRefusal(() => registry.authorize(proof, request()))
  })

  it('fences transport verification that completes after revocation', async () => {
    let release!: (value: unknown) => void
    const trust = fixture({
      verifyTransportPeer: vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            release = resolve
          })
      )
    })
    await trust.registry.enroll(validEnrollment(), 'trusted-enrollment')
    const pending = trust.registry.verify(validVerification())
    await trust.registry.revoke('adam-primary', 1, 'trusted-revocation')
    release(peer())
    await expect(pending).rejects.toBeInstanceOf(AdamServicePrincipalRegistryError)
  })

  it('redacts accessor, Proxy and authority exceptions without exposing caller data', async () => {
    const { registry, trust } = await enrolled()
    const accessor = Object.defineProperty({}, 'peer', {
      get() {
        throw new Error(`secret ${credential}`)
      }
    })
    await expect(registry.verify(accessor)).rejects.toMatchObject({
      name: 'AdamServicePrincipalRegistryError',
      message: 'ADAM service principal is unavailable.'
    })
    const enrollmentProxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(`secret ${credential}`)
        }
      }
    )
    await expect(registry.enroll(enrollmentProxy, 'trusted-enrollment')).rejects.toMatchObject({
      name: 'AdamServicePrincipalRegistryError',
      message: 'ADAM service principal is unavailable.'
    })
    expect(trust.verifyEnrollment).toHaveBeenCalledTimes(1)
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(`secret ${credential}`)
        }
      }
    )
    await expect(registry.verify(proxy)).rejects.toMatchObject({
      name: 'AdamServicePrincipalRegistryError',
      message: 'ADAM service principal is unavailable.'
    })
    expect(trust.verifyTransportPeer).not.toHaveBeenCalled()
    trust.verifyTransportPeer = vi.fn(async () => {
      throw new Error(`secret ${credential}`)
    })
    await expect(registry.verify(validVerification())).rejects.toMatchObject({
      name: 'AdamServicePrincipalRegistryError',
      message: 'ADAM service principal is unavailable.'
    })
  })

  it('redacts proxy input during authorization and never accepts a copied proof', async () => {
    const { registry } = await enrolled()
    const proof = await registry.verify(validVerification())
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(`secret ${credential}`)
        }
      }
    )
    expectFixedRefusal(() => registry.authorize(proof, proxy))
    expectFixedRefusal(() => registry.authorize(new Proxy(proof, {}), request()))
  })
})
