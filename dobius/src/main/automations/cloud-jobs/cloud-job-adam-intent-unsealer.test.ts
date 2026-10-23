import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {}, safeStorage: {} }))
import { CloudJobAdamIntentUnsealerError } from './cloud-job-adam-intent-unsealer'
import {
  capability,
  ciphertext,
  deferred,
  identity,
  intentId,
  purpose,
  request,
  runtime
} from './cloud-job-adam-intent-unsealer-test-fixtures'
import { PURPOSE, SEALED_PREFIX } from './cloud-job-adam-intent-protocol'

afterEach(() => vi.clearAllMocks())

async function rejected(f: ReturnType<typeof runtime>, input: unknown) {
  const error = await f.unsealer.unseal(input).then(
    () => undefined,
    (caught: unknown) => caught
  )
  expectFixedError(error)
}

function expectFixedError(error: unknown) {
  expect(error).toBeInstanceOf(CloudJobAdamIntentUnsealerError)
  expect(error).toMatchObject({
    name: 'CloudJobAdamIntentUnsealerError',
    message: 'ADAM intent recovery is unavailable.'
  })
  expect(String(error)).not.toContain(capability)
}

describe('main-owned ADAM intent recovery unsealer', () => {
  it.each(['darwin', 'win32', 'linux'])(
    'returns the exact expired grant on %s fixtures',
    async (platform) => {
      const f = runtime({ platform })
      const result = await f.unsealer.unseal(request())
      expect(result).toEqual({ intentId, grant: { ...identity, capability } })
      expect(result.grant.expiresAtMs).toBe(identity.expiresAtMs)
      expect(f.calls.ciphertext).toEqual(ciphertext)
      expect(f.calls.decrypt).toBe(1)
      expect(result).not.toHaveProperty('plaintext')
      if (platform === 'linux') {
        expect(f.calls.backend).toBe(6)
      }
    }
  )

  it.each([
    ['wrong prefix', 'sealed:other:v1:YWJj'],
    ['wrong version', 'sealed:dobius-adam-intent:v2:YWJj'],
    ['empty data', SEALED_PREFIX],
    ['noncanonical base64', `${SEALED_PREFIX}YWJj `],
    ['noncanonical padding', `${SEALED_PREFIX}YR==`],
    ['oversized request', `${SEALED_PREFIX}${'A'.repeat(64 * 1024)}`]
  ])('rejects %s before decrypt', async (_label, sealed) => {
    const f = runtime()
    await rejected(f, { ...request(), sealedEnvelope: sealed })
    expect(f.calls.decrypt).toBe(0)
    expect(f.calls.available).toBe(0)
  })

  it.each([
    ['intent', purpose({ intentId: 'cf6dfd6b-7514-4f70-bb71-8c74b19f510e' })],
    ['purpose', purpose({ purpose: 'other-purpose' })],
    ['version', purpose({ schemaVersion: 2 })]
  ])('refuses decrypted %s mismatch', async (_label, envelope) => {
    const f = runtime({ result: { result: JSON.stringify(envelope), shouldReEncrypt: false } })
    await rejected(f, request())
    expect(f.calls.decrypt).toBe(1)
  })

  it.each([
    ['schemaVersion', 2],
    ['bindingId', 'cf6dfd6b-7514-4f70-bb71-8c74b19f510e'],
    ['adamInstanceId', 'adam-other'],
    ['parentObjectiveId', 'parent-other'],
    ['parentObjectiveVersion', 4],
    ['projectId', 'project-other'],
    ['contextDigest', 'd'.repeat(64)],
    ['requestFingerprint', 'e'.repeat(64)],
    ['expiresAtMs', identity.expiresAtMs + 1]
  ])('rejects a changed bound identity field: %s', async (field, value) => {
    const changedIdentity = { ...identity, [field]: value }
    const f = runtime({
      result: {
        result: JSON.stringify(purpose({ identity: changedIdentity })),
        shouldReEncrypt: false
      }
    })
    await rejected(f, request())
    expect(f.calls.decrypt).toBe(1)
  })

  it('rejects malformed authenticated ciphertext and invalid capability bounds', async () => {
    const tampered = runtime({
      decrypt: async () => {
        throw new Error(capability)
      }
    })
    await rejected(tampered, {
      ...request(),
      sealedEnvelope: `${SEALED_PREFIX}${Buffer.from('tampered-ciphertext').toString('base64')}`
    })
    for (const value of ['', 'short', 'x'.repeat(513)]) {
      const f = runtime({
        result: { result: JSON.stringify(purpose({ capability: value })), shouldReEncrypt: false }
      })
      await rejected(f, request())
    }
  })

  it.each([
    ['null result', null],
    ['malformed object', { result: 42, shouldReEncrypt: false }],
    [
      'extra result key',
      { result: JSON.stringify(purpose()), shouldReEncrypt: false, extra: true }
    ],
    ['oversized plaintext', { result: 'x'.repeat(64 * 1024 + 1), shouldReEncrypt: false }],
    ['reencryption request', { result: JSON.stringify(purpose()), shouldReEncrypt: true }]
  ])('redacts and refuses %s from Electron', async (_label, result) => {
    const f = runtime({ result })
    await rejected(f, request())
  })

  it.each(['accessor', 'proxy get'])('redacts throwing decrypt result %s', async (kind) => {
    const rawResult =
      kind === 'accessor'
        ? Object.defineProperty({}, 'result', {
            get: () => {
              throw new Error(capability)
            }
          })
        : new Proxy(
            {},
            {
              get: () => {
                throw new Error(capability)
              }
            }
          )
    const f = runtime({ result: rawResult })
    await rejected(f, request())
    expect(f.calls.decrypt).toBe(1)
  })

  it('redacts caller accessors before runtime/backend access', async () => {
    const raw = Object.defineProperty(request(), 'intentId', {
      get: () => {
        throw new Error(capability)
      }
    })
    const f = runtime({ platform: 'linux' })
    await rejected(f, raw)
    expect(f.calls.available).toBe(0)
    expect(f.calls.backend).toBe(0)
  })

  it('redacts throwing request proxy traps before runtime/backend access', async () => {
    const raw = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error(capability)
        }
      }
    )
    const f = runtime({ platform: 'linux' })
    await rejected(f, raw)
    expect(f.calls.available).toBe(0)
    expect(f.calls.backend).toBe(0)
  })

  it('refuses unavailable or unsupported runtime before decrypt', async () => {
    const cases: [ReturnType<typeof runtime>, number][] = [
      [runtime({ ready: false }), 0],
      [runtime({ available: async () => false }), 1],
      [runtime({ electronVersion: '42.3.3' }), 0],
      [runtime({ electronVersion: 'unknown' }), 0],
      [runtime({ platform: 'linux', backend: 'basic_text' }), 0],
      [runtime({ platform: 'linux', backend: 'unknown' }), 0]
    ]
    for (const [f, availabilityCalls] of cases) {
      await rejected(f, request())
      expect(f.calls.decrypt).toBe(0)
      expect(f.calls.available).toBe(availabilityCalls)
    }
  })

  it('fences disposal and backend/readiness changes during awaited recovery', async () => {
    const gate = deferred<boolean>()
    const f = runtime({ available: () => gate.promise })
    const pending = f.unsealer.unseal(request())
    f.unsealer.dispose()
    gate.resolve(true)
    const disposalError = await pending.then(
      () => undefined,
      (caught: unknown) => caught
    )
    expectFixedError(disposalError)
    expect(f.calls.decrypt).toBe(0)

    const backendGate = deferred<boolean>()
    const backend = runtime({ platform: 'linux', available: () => backendGate.promise })
    const backendPending = backend.unsealer.unseal(request())
    backend.state.backend = 'unknown'
    backendGate.resolve(true)
    await expect(backendPending).rejects.toBeInstanceOf(CloudJobAdamIntentUnsealerError)
    expect(backend.calls.decrypt).toBe(0)

    const readyGate = deferred<boolean>()
    const readiness = runtime({ available: () => readyGate.promise })
    const readyPending = readiness.unsealer.unseal(request())
    readiness.state.ready = false
    readyGate.resolve(true)
    await expect(readyPending).rejects.toBeInstanceOf(CloudJobAdamIntentUnsealerError)
    expect(readiness.calls.decrypt).toBe(0)

    const versionGate = deferred<boolean>()
    const version = runtime({ available: () => versionGate.promise })
    const versionPending = version.unsealer.unseal(request())
    version.state.electronVersion = '42.3.3'
    versionGate.resolve(true)
    await expect(versionPending).rejects.toBeInstanceOf(CloudJobAdamIntentUnsealerError)
    expect(version.calls.decrypt).toBe(0)
  })

  it('uses the exact shared ADAM purpose and rejects absent decrypt API', async () => {
    expect(purpose().purpose).toBe(PURPOSE)
    const f = runtime()
    f.storage.decryptStringAsync = undefined as never
    await rejected(f, request())
    expect(f.calls.available).toBe(0)
  })

  it('does not mutate or extend the caller identity across availability wait', async () => {
    const gate = deferred<boolean>()
    const f = runtime({ available: () => gate.promise })
    const input = request()
    const pending = f.unsealer.unseal(input)
    input.identity.projectId = 'mutated'
    gate.resolve(true)
    const result = await pending
    expect(result.grant.projectId).toBe(identity.projectId)
    expect(result.grant.expiresAtMs).toBe(identity.expiresAtMs)
  })
})
