import { z } from 'zod'

const LinuxBackend = z.enum(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])

export type IntentPlatform = 'darwin' | 'win32' | 'linux'
export type IntentSafeStorage = {
  isAsyncEncryptionAvailable?: () => Promise<boolean>
  encryptStringAsync?: (plainText: string) => Promise<Buffer>
  decryptStringAsync?: (ciphertext: Buffer) => Promise<unknown>
  getSelectedStorageBackend?: () => string
}
export type IntentRuntimeBindings = {
  platform: string
  electronVersion: string | undefined
  app: { isReady: () => boolean }
  safeStorage: IntentSafeStorage
}
export type IntentRuntimeReader = () => IntentRuntimeBindings
export type IntentRuntimeOperation = 'encrypt' | 'decrypt'
export type IntentRuntimeSnapshot = IntentRuntimeBindings & {
  platform: IntentPlatform
  backend: string | null
}

export function inspectIntentRuntime(
  runtime: IntentRuntimeBindings,
  operation: IntentRuntimeOperation
): IntentRuntimeSnapshot {
  if (runtime.app.isReady() !== true || !isSupportedIntentElectron(runtime.electronVersion)) {
    throw new Error('unsupported runtime')
  }
  if (!['darwin', 'win32', 'linux'].includes(runtime.platform)) {
    throw new Error('unsupported platform')
  }
  let backend: string | null = null
  if (runtime.platform === 'linux') {
    if (typeof runtime.safeStorage.getSelectedStorageBackend !== 'function') {
      throw new Error('unsupported backend')
    }
    backend = runtime.safeStorage.getSelectedStorageBackend()
    if (!LinuxBackend.safeParse(backend).success) {
      throw new Error('unsupported backend')
    }
  }
  if (typeof runtime.safeStorage.isAsyncEncryptionAvailable !== 'function') {
    throw new Error('async storage unavailable')
  }
  const operationMethod =
    operation === 'encrypt'
      ? runtime.safeStorage.encryptStringAsync
      : runtime.safeStorage.decryptStringAsync
  if (typeof operationMethod !== 'function') {
    throw new Error(`async ${operation} unavailable`)
  }
  return { ...runtime, platform: runtime.platform as IntentPlatform, backend }
}

export function assertIntentRuntimeCurrent(
  reader: IntentRuntimeReader,
  snapshot: IntentRuntimeSnapshot,
  expectedGeneration: number,
  generation: number,
  disposed: boolean,
  operation: IntentRuntimeOperation
): void {
  if (disposed || generation !== expectedGeneration) {
    throw new Error('stale runtime')
  }
  const current = inspectIntentRuntime(reader(), operation)
  if (
    current.app !== snapshot.app ||
    current.safeStorage !== snapshot.safeStorage ||
    current.platform !== snapshot.platform ||
    current.electronVersion !== snapshot.electronVersion ||
    current.backend !== snapshot.backend
  ) {
    throw new Error('runtime changed')
  }
}

export function requireIntentAvailability(storage: IntentSafeStorage): Promise<boolean> {
  if (typeof storage.isAsyncEncryptionAvailable !== 'function') {
    throw new Error('async storage unavailable')
  }
  return storage.isAsyncEncryptionAvailable()
}

export function requireIntentEncryption(
  storage: IntentSafeStorage
): (plainText: string) => Promise<Buffer> {
  if (typeof storage.encryptStringAsync !== 'function') {
    throw new Error('async encryption unavailable')
  }
  return (plainText) => storage.encryptStringAsync!(plainText)
}

export function requireIntentDecryption(
  storage: IntentSafeStorage
): (ciphertext: Buffer) => Promise<unknown> {
  if (typeof storage.decryptStringAsync !== 'function') {
    throw new Error('async decryption unavailable')
  }
  return (ciphertext) => storage.decryptStringAsync!(ciphertext)
}

export function isSupportedIntentElectron(raw: string | undefined): boolean {
  if (!raw) {
    return false
  }
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw)
  if (!match) {
    return false
  }
  const version = match.slice(1, 4).map(Number)
  if (version.some((part) => !Number.isSafeInteger(part))) {
    return false
  }
  const [major = 0, minor = 0, patch = 0] = version
  return major > 42 || (major === 42 && (minor > 4 || (minor === 4 && patch >= 1)))
}
