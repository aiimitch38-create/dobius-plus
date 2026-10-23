const MAX_RESPONSE_BYTES = 64 * 1024

export class RequestDeadlineExceeded extends Error {}
export class ResponseTooLarge extends Error {}

export async function readBoundedJson(
  response: Response,
  limit: number,
  signal: AbortSignal
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new TypeError('Response body is unavailable.')
  }
  const chunks: Uint8Array[] = []
  let total = 0
  let cancelResult: Promise<void> | undefined
  const cancelReader = () => {
    cancelResult ??= reader.cancel().then(
      () => undefined,
      () => undefined
    )
  }
  let rejectAborted: ((error: Error) => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = reject
  })
  const onAbort = () => {
    cancelReader()
    rejectAborted?.(new RequestDeadlineExceeded())
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      if (signal.aborted) {
        throw new RequestDeadlineExceeded()
      }
      const next = await Promise.race([reader.read(), aborted])
      if (next.done) {
        break
      }
      total += next.value.byteLength
      if (total > limit) {
        void reader.cancel().catch(() => undefined)
        throw new ResponseTooLarge()
      }
      chunks.push(next.value)
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (!signal.aborted) {
      reader.releaseLock()
    } else {
      // Do not await cancellation: the deadline path must not inherit a stalled reader.
      void cancelResult
    }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  )
}

export function cancelAdamResponse(response: Response): void {
  if (response.body) {
    void response.body.cancel().catch(() => undefined)
  }
}

export function maxAdamResponseBytes(): number {
  return MAX_RESPONSE_BYTES
}
