import { vi } from 'vitest'
import { createCloudJobAdamIntentUnsealerWithRuntime } from './cloud-job-adam-intent-unsealer'
import { PURPOSE, SEALED_PREFIX } from './cloud-job-adam-intent-protocol'

export const identity = {
  schemaVersion: 1 as const,
  bindingId: '7a841805-56d9-4bb1-b81b-f22997413f16',
  adamInstanceId: 'adam-local',
  parentObjectiveId: 'parent-1',
  parentObjectiveVersion: 3,
  projectId: 'project-1',
  contextDigest: 'c'.repeat(64),
  requestFingerprint: 'f'.repeat(64),
  expiresAtMs: 1_700_000_000_000
}
export const capability = 'synthetic-capability-value-not-a-secret-0001'
export const intentId = 'bb84d71e-205a-4f06-9c8f-99ec032320b1'
export const ciphertext = Buffer.from('synthetic-encrypted-adam-intent')
export const sealedEnvelope = `${SEALED_PREFIX}${ciphertext.toString('base64')}`
export const purpose = (overrides: Record<string, unknown> = {}) => ({
  purpose: PURPOSE,
  schemaVersion: 1,
  intentId,
  identity: { ...identity },
  capability,
  ...overrides
})
export const request = () => ({
  schemaVersion: 1,
  intentId,
  identity: { ...identity },
  sealedEnvelope
})
export const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

export function runtime(
  overrides: Partial<{
    platform: string
    electronVersion: string | undefined
    ready: boolean
    backend: string
    available: () => Promise<boolean>
    decrypt: (input: Buffer) => Promise<unknown>
    result: unknown
  }> = {}
) {
  const state = {
    platform: 'darwin',
    electronVersion: '42.4.1',
    ready: true,
    backend: 'gnome_libsecret',
    ...overrides
  }
  const calls: {
    available: number
    decrypt: number
    backend: number
    ciphertext: Buffer
  } = { available: 0, decrypt: 0, backend: 0, ciphertext: Buffer.alloc(0) }
  const storage = {
    isAsyncEncryptionAvailable: vi.fn(async () => {
      calls.available += 1
      return state.available ? state.available() : true
    }),
    decryptStringAsync: vi.fn(async (input: Buffer) => {
      calls.decrypt += 1
      calls.ciphertext = input
      return state.decrypt
        ? state.decrypt(input)
        : state.result !== undefined
          ? state.result
          : {
              result: JSON.stringify(purpose()),
              shouldReEncrypt: false
            }
    }),
    getSelectedStorageBackend: vi.fn(() => {
      calls.backend += 1
      return state.backend
    })
  }
  const app = { isReady: vi.fn(() => state.ready) }
  const unsealer = createCloudJobAdamIntentUnsealerWithRuntime(() => ({
    platform: state.platform,
    electronVersion: state.electronVersion,
    app,
    safeStorage: storage
  }))
  return { state, calls, storage, app, unsealer }
}
