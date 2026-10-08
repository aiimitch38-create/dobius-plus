import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamJson,
  decodeTerminalStreamText,
  TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE
} from './terminal-stream-protocol'
import { TERMINAL_SNAPSHOT_MAX_BYTES } from '../../../src/shared/terminal-scrollback-limits'

export const TERMINAL_SNAPSHOT_ASSEMBLY_TIMEOUT_MS = 30_000
export const TERMINAL_SNAPSHOT_MAX_CHUNKS = 256

export type TerminalSnapshotDiscardReason =
  | 'oversized'
  | 'invalid-start'
  | 'byte-limit'
  | 'chunk-limit'
  | 'expired'

export type TerminalSnapshotState = {
  streamId: number
  meta: Record<string, unknown>
  chunks: string[]
  receivedBytes: number
  chunkCount: number
  startedAt: number
  expiryTimer: ReturnType<typeof setTimeout> | null
}

export type StreamingListener = (result: unknown) => void

export type TerminalBinaryFrameOptions = {
  terminalSnapshots: Map<number, TerminalSnapshotState>
  getListener: (streamId: number) => StreamingListener | undefined
  recordValidatedInboundTraffic: () => void
}

export function clearTerminalSnapshot(
  snapshots: Map<number, TerminalSnapshotState>,
  streamId: number
): void {
  const snapshot = snapshots.get(streamId)
  if (snapshot?.expiryTimer) {
    clearTimeout(snapshot.expiryTimer)
  }
  snapshots.delete(streamId)
}

export function clearTerminalStreams(
  streamIds: Iterable<number>,
  listeners: Map<number, StreamingListener>,
  snapshots: Map<number, TerminalSnapshotState>
): void {
  for (const streamId of streamIds) {
    listeners.delete(streamId)
    clearTerminalSnapshot(snapshots, streamId)
  }
}

export function clearTerminalStreamsForRequest(
  requestId: string,
  cleanup: {
    streamIdsByRequest: Map<string, Set<number>>
    listeners: Map<number, StreamingListener>
    snapshots: Map<number, TerminalSnapshotState>
  }
): void {
  const streamIds = cleanup.streamIdsByRequest.get(requestId)
  if (!streamIds) {
    return
  }
  clearTerminalStreams(streamIds, cleanup.listeners, cleanup.snapshots)
  cleanup.streamIdsByRequest.delete(requestId)
}

function discardTerminalSnapshot(
  options: TerminalBinaryFrameOptions,
  streamId: number,
  reason: TerminalSnapshotDiscardReason
): void {
  clearTerminalSnapshot(options.terminalSnapshots, streamId)
  options.getListener(streamId)?.({ type: 'snapshot-error', streamId, reason })
}

export function handleTerminalBinaryFrame(
  bytes: Uint8Array,
  options: TerminalBinaryFrameOptions
): void {
  const frame = decodeTerminalStreamFrame(bytes)
  if (!frame) {
    return
  }
  const listener = options.getListener(frame.streamId)
  if (!listener) {
    options.recordValidatedInboundTraffic()
    return
  }
  if (frame.opcode === TerminalStreamOpcode.Output) {
    options.recordValidatedInboundTraffic()
    listener({
      type: 'data',
      streamId: frame.streamId,
      chunk: decodeTerminalStreamText(frame.payload)
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.SnapshotStart) {
    const meta = decodeTerminalStreamJson<Record<string, unknown>>(frame.payload)
    if (!meta) {
      discardTerminalSnapshot(options, frame.streamId, 'invalid-start')
      return
    }
    options.recordValidatedInboundTraffic()
    clearTerminalSnapshot(options.terminalSnapshots, frame.streamId)
    const snapshot: TerminalSnapshotState = {
      streamId: frame.streamId,
      meta,
      chunks: [],
      receivedBytes: 0,
      chunkCount: 0,
      startedAt: Date.now(),
      expiryTimer: null
    }
    options.terminalSnapshots.set(frame.streamId, snapshot)
    snapshot.expiryTimer = setTimeout(() => {
      if (options.terminalSnapshots.get(frame.streamId) === snapshot) {
        discardTerminalSnapshot(options, frame.streamId, 'expired')
      }
    }, TERMINAL_SNAPSHOT_ASSEMBLY_TIMEOUT_MS)
    return
  }
  if (frame.opcode === TerminalStreamOpcode.SnapshotChunk) {
    options.recordValidatedInboundTraffic()
    const snapshot = options.terminalSnapshots.get(frame.streamId)
    if (!snapshot) {
      return
    }
    if (Date.now() - snapshot.startedAt >= TERMINAL_SNAPSHOT_ASSEMBLY_TIMEOUT_MS) {
      discardTerminalSnapshot(options, frame.streamId, 'expired')
      return
    }
    if (snapshot.receivedBytes + frame.payload.byteLength > TERMINAL_SNAPSHOT_MAX_BYTES) {
      discardTerminalSnapshot(options, frame.streamId, 'byte-limit')
      return
    }
    if (snapshot.chunkCount >= TERMINAL_SNAPSHOT_MAX_CHUNKS) {
      discardTerminalSnapshot(options, frame.streamId, 'chunk-limit')
      return
    }
    snapshot.receivedBytes += frame.payload.byteLength
    snapshot.chunkCount += 1
    snapshot.chunks.push(decodeTerminalStreamText(frame.payload))
    return
  }
  if (frame.opcode === TerminalStreamOpcode.SnapshotEnd) {
    options.recordValidatedInboundTraffic()
    const snapshot = options.terminalSnapshots.get(frame.streamId)
    if (!snapshot) {
      return
    }
    if (Date.now() - snapshot.startedAt >= TERMINAL_SNAPSHOT_ASSEMBLY_TIMEOUT_MS) {
      discardTerminalSnapshot(options, frame.streamId, 'expired')
      return
    }
    clearTerminalSnapshot(options.terminalSnapshots, frame.streamId)
    const kind = snapshot.meta.kind === 'resized' ? 'resized' : 'scrollback'
    listener({
      ...snapshot.meta,
      type: kind,
      streamId: frame.streamId,
      serialized: snapshot.chunks.join('')
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.Resized) {
    const meta = decodeTerminalStreamJson<Record<string, unknown>>(frame.payload)
    if (!meta) {
      return
    }
    options.recordValidatedInboundTraffic()
    listener({
      ...meta,
      type: 'resized',
      streamId: frame.streamId
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.Metadata) {
    const meta = decodeTerminalStreamJson<Record<string, unknown>>(frame.payload)
    if (!meta) {
      return
    }
    options.recordValidatedInboundTraffic()
    listener({
      ...meta,
      type: 'metadata',
      streamId: frame.streamId
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.Error) {
    options.recordValidatedInboundTraffic()
    const message = decodeTerminalStreamText(frame.payload)
    if (message === TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE) {
      clearTerminalSnapshot(options.terminalSnapshots, frame.streamId)
      listener({
        type: 'snapshot-error',
        streamId: frame.streamId,
        reason: 'oversized',
        message
      })
      return
    }
    listener({
      type: 'error',
      streamId: frame.streamId,
      message
    })
  }
}
