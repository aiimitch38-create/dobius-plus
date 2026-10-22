import { TELEGRAM_INFERENCE_TIMEOUT_MS } from './reply-limits'

export function boundedTelegramInference<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  abortOperation: () => void
): Promise<T> {
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
      abortOperation()
      reject(new Error('operation-timeout'))
    }, TELEGRAM_INFERENCE_TIMEOUT_MS)
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
