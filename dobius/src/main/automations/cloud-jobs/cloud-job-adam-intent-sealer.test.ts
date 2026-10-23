import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, safeStorage: {} }))

import {
  CloudJobAdamIntentSealerError,
  createCloudJobAdamIntentSealerWithRuntime
} from './cloud-job-adam-intent-sealer'

const identity = {
  schemaVersion: 1 as const,
  bindingId: '7a841805-56d9-4bb1-b81b-f22997413f16',
  adamInstanceId: 'adam-local',
  parentObjectiveId: 'parent-1',
  parentObjectiveVersion: 3,
  projectId: 'project-1',
  contextDigest: 'c'.repeat(64),
  requestFingerprint: 'f'.repeat(64),
  expiresAtMs: 1_800_000_000_000
}
const capability = 'synthetic-capability-value-not-a-secret-0001'
const intentId = 'bb84d71e-205a-4f06-9c8f-99ec032320b1'
const request = () => ({ schemaVersion: 1, intentId, identity: { ...identity }, capability })
const callerInput = (kind: string): unknown => {
  const fail = () => {
    throw new Error(capability)
  }
  if (kind === 'accessor') {
    return Object.defineProperty(request(), 'schemaVersion', { get: fail })
  }
  if (kind === 'proxy ownKeys') {
    return new Proxy({}, { ownKeys: fail })
  }
  return new Proxy(request(), {
    get: (target, key, receiver) =>
      key === 'schemaVersion' ? fail() : Reflect.get(target, key, receiver)
  })
}
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function runtime(
  overrides: Partial<{
    platform: string
    electronVersion: string | undefined
    ready: boolean
    backend: string
    available: () => Promise<boolean>
    encrypt: (plainText: string) => Promise<unknown>
  }> = {}
) {
  const state = {
    platform: 'darwin',
    electronVersion: '42.4.1',
    ready: true,
    backend: 'gnome_libsecret',
    ...overrides
  }
  const calls = { available: 0, encrypt: 0, plaintext: '' }
  const storage = {
    isAsyncEncryptionAvailable: vi.fn(async () => {
      calls.available += 1
      return state.available ? state.available() : true
    }),
    encryptStringAsync: vi.fn(async (plainText: string) => {
      calls.encrypt += 1
      calls.plaintext = plainText
      return state.encrypt ? state.encrypt(plainText) : Buffer.from('fixture-ciphertext')
    }),
    getSelectedStorageBackend: vi.fn(() => state.backend)
  }
  const app = { isReady: vi.fn(() => state.ready) }
  const sealer = createCloudJobAdamIntentSealerWithRuntime(() => ({
    platform: state.platform,
    electronVersion: state.electronVersion,
    app,
    safeStorage: storage as never
  }))
  return { state, calls, storage, app, sealer }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('main-owned ADAM intent seal adapter', () => {
  it.each(['darwin', 'win32', 'linux'])(
    'seals the full versioned purpose envelope on %s fixtures',
    async (platform) => {
      const f = runtime({ platform })
      const sealed = await f.sealer.seal(request())
      expect(f.calls.plaintext).toEqual(
        JSON.stringify({
          purpose: 'dobius.adam-capability-intent',
          schemaVersion: 1,
          intentId,
          identity,
          capability
        })
      )
      expect(sealed).toMatch(/^sealed:dobius-adam-intent:v1:/)
      expect(sealed.length).toBeLessThanOrEqual(64 * 1024)
      expect(sealed).not.toContain(capability)
      expect(
        Buffer.from(sealed.slice('sealed:dobius-adam-intent:v1:'.length), 'base64').toString()
      ).toBe('fixture-ciphertext')
      if (platform === 'linux') {
        expect(f.storage.getSelectedStorageBackend).toHaveBeenCalledTimes(6)
      }
    }
  )

  it('rejects malformed strict envelopes before touching the backend', async () => {
    const f = runtime()
    await expect(f.sealer.seal({ ...request(), extra: true })).rejects.toBeInstanceOf(
      CloudJobAdamIntentSealerError
    )
    await expect(f.sealer.seal({ ...request(), intentId: 'invalid' })).rejects.toBeInstanceOf(
      CloudJobAdamIntentSealerError
    )
    await expect(
      f.sealer.seal({ ...request(), identity: { ...identity, projectId: 'bad/value' } })
    ).rejects.toBeInstanceOf(CloudJobAdamIntentSealerError)
    expect(f.calls.available).toBe(0)
    expect(f.calls.encrypt).toBe(0)
  })

  it.each(['accessor', 'proxy ownKeys', 'proxy get'])(
    'redacts caller-controlled %s failures before backend access',
    async (kind) => {
      const f = runtime({ platform: 'linux' })
      const error = await f.sealer.seal(callerInput(kind)).then(
        () => undefined,
        (caught: unknown) => caught
      )
      expect(error).toBeInstanceOf(CloudJobAdamIntentSealerError)
      expect(error).toMatchObject({
        name: 'CloudJobAdamIntentSealerError',
        message: 'ADAM intent sealing is unavailable.'
      })
      expect(String(error)).not.toContain(capability)
      expect(f.calls.available).toBe(0)
      expect(f.calls.encrypt).toBe(0)
      expect(f.storage.getSelectedStorageBackend).not.toHaveBeenCalled()
    }
  )

  it('detaches the complete identity before awaited availability', async () => {
    const gate = deferred<boolean>()
    const f = runtime({ available: () => gate.promise })
    const raw = request()
    const pending = f.sealer.seal(raw)
    raw.identity.parentObjectiveVersion = 99
    raw.identity.projectId = 'mutated'
    raw.capability = 'mutated-capability-value-not-secret'
    gate.resolve(true)
    await pending
    expect(JSON.parse(f.calls.plaintext)).toMatchObject({ identity, capability })
  })

  it('requires ready app and positive async availability', async () => {
    const unready = runtime({ ready: false })
    await expect(unready.sealer.seal(request())).rejects.toBeInstanceOf(
      CloudJobAdamIntentSealerError
    )
    expect(unready.calls.available).toBe(0)
    const unavailable = runtime({ available: async () => false })
    await expect(unavailable.sealer.seal(request())).rejects.toBeInstanceOf(
      CloudJobAdamIntentSealerError
    )
    expect(unavailable.calls.encrypt).toBe(0)
    const malformedAvailability = runtime({ available: async () => 'yes' as never })
    await expect(malformedAvailability.sealer.seal(request())).rejects.toBeInstanceOf(
      CloudJobAdamIntentSealerError
    )
    expect(malformedAvailability.calls.encrypt).toBe(0)
    const throwing = runtime({
      available: async () => {
        throw new Error(capability)
      }
    })
    await expect(throwing.sealer.seal(request())).rejects.toThrow(
      'ADAM intent sealing is unavailable.'
    )
    expect(String(await throwing.sealer.seal(request()).catch((error) => error))).not.toContain(
      capability
    )
  })

  it('refuses incomplete async safeStorage APIs', async () => {
    const f = runtime()
    f.storage.encryptStringAsync = undefined as never
    await expect(f.sealer.seal(request())).rejects.toBeInstanceOf(CloudJobAdamIntentSealerError)
    expect(f.calls.available).toBe(0)
    const noAvailability = runtime()
    noAvailability.storage.isAsyncEncryptionAvailable = undefined as never
    await expect(noAvailability.sealer.seal(request())).rejects.toBeInstanceOf(
      CloudJobAdamIntentSealerError
    )
  })

  it.each(['basic_text', 'unknown', 'other'])(
    'refuses Linux backend %s even if availability would pass',
    async (backend) => {
      const f = runtime({ platform: 'linux', backend })
      await expect(f.sealer.seal(request())).rejects.toBeInstanceOf(CloudJobAdamIntentSealerError)
      expect(f.calls.available).toBe(0)
      expect(f.calls.encrypt).toBe(0)
    }
  )

  it.each(['42.3.3', '42.4.1-beta.1', undefined, 'unknown'])(
    'refuses Electron version %s before async secret APIs',
    async (electronVersion) => {
      const f = runtime({ electronVersion })
      await expect(f.sealer.seal(request())).rejects.toBeInstanceOf(CloudJobAdamIntentSealerError)
      expect(f.calls.available).toBe(0)
      expect(f.calls.encrypt).toBe(0)
    }
  )

  it('redacts encryption errors and rejects malformed, oversized, and visibly plaintext output', async () => {
    const thrown = runtime({
      encrypt: async () => {
        throw new Error(capability)
      }
    })
    await expect(thrown.sealer.seal(request())).rejects.toThrow(
      'ADAM intent sealing is unavailable.'
    )
    expect(String(await thrown.sealer.seal(request()).catch((error) => error))).not.toContain(
      capability
    )
    for (const encrypt of [
      async () => 'not-a-buffer',
      async () => Buffer.alloc(64 * 1024),
      async () => Buffer.from(`cipher:${capability}`)
    ]) {
      const f = runtime({ encrypt })
      await expect(f.sealer.seal(request())).rejects.toBeInstanceOf(CloudJobAdamIntentSealerError)
    }
  })

  it('fences disposal and readiness/backend drift across awaited operations', async () => {
    const availability = deferred<boolean>()
    const duringAvailability = runtime({ available: () => availability.promise })
    const pendingAvailability = duringAvailability.sealer.seal(request())
    duringAvailability.sealer.invalidate()
    availability.resolve(true)
    await expect(pendingAvailability).rejects.toBeInstanceOf(CloudJobAdamIntentSealerError)
    await expect(duringAvailability.sealer.seal(request())).rejects.toBeInstanceOf(
      CloudJobAdamIntentSealerError
    )

    const encryption = deferred<unknown>()
    const duringEncryption = runtime({ encrypt: () => encryption.promise })
    const pendingEncryption = duringEncryption.sealer.seal(request())
    await vi.waitFor(() => expect(duringEncryption.calls.encrypt).toBe(1))
    duringEncryption.sealer.dispose()
    encryption.resolve(Buffer.from('fixture-ciphertext'))
    await expect(pendingEncryption).rejects.toBeInstanceOf(CloudJobAdamIntentSealerError)

    const backend = deferred<boolean>()
    const drift = runtime({ platform: 'linux', available: () => backend.promise })
    const pendingDrift = drift.sealer.seal(request())
    drift.state.backend = 'unknown'
    backend.resolve(true)
    await expect(pendingDrift).rejects.toBeInstanceOf(CloudJobAdamIntentSealerError)
    expect(drift.calls.encrypt).toBe(0)

    const ready = deferred<boolean>()
    const readinessDrift = runtime({ available: () => ready.promise })
    const pendingReadiness = readinessDrift.sealer.seal(request())
    readinessDrift.state.ready = false
    ready.resolve(true)
    await expect(pendingReadiness).rejects.toBeInstanceOf(CloudJobAdamIntentSealerError)
    expect(readinessDrift.calls.encrypt).toBe(0)
  })
})
