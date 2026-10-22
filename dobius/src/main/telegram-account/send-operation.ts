export function boundedTelegramSend<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  abortOperation: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      return reject(new Error('operation-cancelled'))
    }
    const clear = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    const timer = setTimeout(() => {
      clear()
      abortOperation()
      reject(new Error('operation-timeout'))
    }, 60_000)
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
