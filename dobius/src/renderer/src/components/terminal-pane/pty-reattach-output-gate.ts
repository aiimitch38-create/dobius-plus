import type { PtyDataMeta } from './pty-dispatcher'

export type PtyReattachOutputChunk = {
  data: string
  meta?: PtyDataMeta
}

export type PtyReattachOutputGateOptions = {
  onOverflowData?: (data: string) => void
  onAfterOverflowData?: (data: string) => number
  onDiscard?: () => void
}

const MAX_BUFFERED_REATTACH_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_BUFFERED_REATTACH_OUTPUT_CHUNKS = 4_096

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        // Why: count each callback independently; a pair split across callbacks
        // is conservatively charged as two U+FFFD encodings to keep the cap safe.
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

/** Holds early PTY data until reattach replay has been applied, preserving stream order. */
export function createPtyReattachOutputGate(
  onData: (data: string, meta?: PtyDataMeta) => void,
  options: PtyReattachOutputGateOptions = {}
): {
  onData: (data: string, meta?: PtyDataMeta) => void
  release: () => boolean
  discard: () => void
  overflowed: () => boolean
} {
  let open = false
  let discarded = false
  let didOverflow = false
  let bufferedBytes = 0
  let chunks: PtyReattachOutputChunk[] = []

  const flush = (): void => {
    const pending = chunks
    chunks = []
    bufferedBytes = 0
    for (const chunk of pending) {
      onData(chunk.data, chunk.meta)
    }
  }

  return {
    onData(data, meta) {
      if (discarded) {
        return
      }
      if (open || data.length === 0) {
        if (open && didOverflow && options.onAfterOverflowData) {
          const consumedChars = options.onAfterOverflowData(data)
          const consumedRawBytes =
            typeof meta?.rawLength === 'number' && consumedChars > 0
              ? utf8ByteLength(data.slice(0, consumedChars))
              : 0
          data = data.slice(consumedChars)
          if (typeof meta?.rawLength === 'number' && consumedRawBytes > 0) {
            meta = { ...meta, rawLength: Math.max(0, meta.rawLength - consumedRawBytes) }
          }
        }
        if (data.length === 0) {
          return
        }
        onData(data, meta)
        return
      }
      if (didOverflow) {
        options.onOverflowData?.(data)
        return
      }
      const dataBytes = utf8ByteLength(data)
      if (
        bufferedBytes + dataBytes > MAX_BUFFERED_REATTACH_OUTPUT_BYTES ||
        chunks.length >= MAX_BUFFERED_REATTACH_OUTPUT_CHUNKS
      ) {
        // Why: an authoritative snapshot is safer than replaying a clipped VT stream.
        didOverflow = true
        for (const chunk of chunks) {
          options.onOverflowData?.(chunk.data)
        }
        options.onOverflowData?.(data)
        chunks = []
        bufferedBytes = 0
        return
      }
      chunks.push({ data, ...(meta ? { meta: { ...meta } } : {}) })
      bufferedBytes += dataBytes
    },
    release() {
      if (discarded) {
        return didOverflow
      }
      open = true
      flush()
      return didOverflow
    },
    discard() {
      discarded = true
      open = false
      chunks = []
      bufferedBytes = 0
      options.onDiscard?.()
    },
    overflowed() {
      return didOverflow
    }
  }
}
