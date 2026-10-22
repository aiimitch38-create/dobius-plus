import type { TelegramSafeError } from '../../shared/telegram-account'
import { TelegramVaultError } from './vault'

const OPERATION_TIMEOUT_MS = 60_000

export function mapError(error: unknown): TelegramSafeError {
  if (error instanceof TelegramVaultError) {
    return error.code === 'unavailable' ? 'secure-storage-unavailable' : 'storage-failed'
  }
  return 'authorization-failed'
}

export function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('operation-cancelled'))
      return
    }
    const clear = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const timer = setTimeout(() => {
      clear()
      reject(new Error('operation-timeout'))
    }, OPERATION_TIMEOUT_MS)
    const onAbort = () => {
      clear()
      reject(new Error('operation-cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        clear()
        resolve(value)
      },
      (error: unknown) => {
        clear()
        reject(error)
      }
    )
  })
}
