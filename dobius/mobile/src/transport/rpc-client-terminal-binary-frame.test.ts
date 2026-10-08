import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MOBILE_SNAPSHOT_BYTE_BUDGET,
  TERMINAL_SNAPSHOT_MAX_BYTES
} from '../../../src/shared/terminal-scrollback-limits'
import { TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE as SHARED_SNAPSHOT_TOO_LARGE_MESSAGE } from '../../../src/shared/terminal-stream-protocol'
import {
  clearTerminalSnapshot,
  handleTerminalBinaryFrame,
  TERMINAL_SNAPSHOT_ASSEMBLY_TIMEOUT_MS,
  TERMINAL_SNAPSHOT_MAX_CHUNKS,
  type TerminalBinaryFrameOptions
} from './rpc-client-terminal-binary-frame'
import {
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
  TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE
} from './terminal-stream-protocol'

function encodeFrame(opcode: TerminalStreamOpcode, streamId: number, payload: unknown): Uint8Array {
  const body =
    typeof payload === 'string'
      ? new TextEncoder().encode(payload)
      : new TextEncoder().encode(JSON.stringify(payload))
  return encodeTerminalStreamFrame({
    opcode,
    streamId,
    seq: 1,
    payload: body
  })
}

describe('handleTerminalBinaryFrame', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the mobile error message compatible with the shared stream protocol', () => {
    expect(TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE).toBe(SHARED_SNAPSHOT_TOO_LARGE_MESSAGE)
  })

  function makeOptions(listener = vi.fn()): TerminalBinaryFrameOptions {
    return {
      terminalSnapshots: new Map(),
      getListener: (streamId) => (streamId === 42 ? listener : undefined),
      recordValidatedInboundTraffic: vi.fn()
    }
  }

  function send(
    options: TerminalBinaryFrameOptions,
    opcode: TerminalStreamOpcode,
    payload: unknown
  ): void {
    handleTerminalBinaryFrame(encodeFrame(opcode, 42, payload), options)
  }

  it('routes terminal metadata frames to the stream listener', () => {
    const listener = vi.fn()
    const recordValidatedInboundTraffic = vi.fn()

    handleTerminalBinaryFrame(
      encodeFrame(TerminalStreamOpcode.Metadata, 42, { cwd: '/repo/src' }),
      {
        terminalSnapshots: new Map(),
        getListener: (streamId) => (streamId === 42 ? listener : undefined),
        recordValidatedInboundTraffic
      }
    )

    expect(recordValidatedInboundTraffic).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ type: 'metadata', streamId: 42, cwd: '/repo/src' })
  })

  it('accepts a complete zero-row snapshot above the soft row-reduction target', () => {
    const listener = vi.fn()
    const options = makeOptions(listener)
    const serialized = 'x'.repeat(MOBILE_SNAPSHOT_BYTE_BUDGET + 1)

    send(options, TerminalStreamOpcode.SnapshotStart, { kind: 'scrollback', cols: 80, rows: 24 })
    for (let offset = 0; offset < serialized.length; offset += 48 * 1024) {
      send(
        options,
        TerminalStreamOpcode.SnapshotChunk,
        serialized.slice(offset, offset + 48 * 1024)
      )
    }
    send(options, TerminalStreamOpcode.SnapshotEnd, '')

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scrollback', streamId: 42, serialized })
    )
    expect(options.terminalSnapshots.size).toBe(0)
  })

  it('counts multibyte text by UTF-8 wire bytes at the admission ceiling', () => {
    const listener = vi.fn()
    const options = makeOptions(listener)
    const exact = `${'x'.repeat(TERMINAL_SNAPSHOT_MAX_BYTES - 4)}💡`

    send(options, TerminalStreamOpcode.SnapshotStart, { kind: 'scrollback' })
    send(options, TerminalStreamOpcode.SnapshotChunk, exact)
    send(options, TerminalStreamOpcode.SnapshotEnd, '')
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scrollback', serialized: exact })
    )

    const overflowListener = vi.fn()
    const overflowOptions = makeOptions(overflowListener)
    const over = `${'x'.repeat(TERMINAL_SNAPSHOT_MAX_BYTES - 3)}💡`
    send(overflowOptions, TerminalStreamOpcode.SnapshotStart, { kind: 'scrollback' })
    send(overflowOptions, TerminalStreamOpcode.SnapshotChunk, over)
    expect(overflowOptions.terminalSnapshots.size).toBe(0)
    expect(overflowListener).toHaveBeenCalledWith({
      type: 'snapshot-error',
      streamId: 42,
      reason: 'byte-limit'
    })
  })

  it('maps a producer oversized Error frame to terminal snapshot recovery metadata', () => {
    const listener = vi.fn()
    const options = makeOptions(listener)
    send(options, TerminalStreamOpcode.SnapshotStart, { kind: 'scrollback' })
    send(options, TerminalStreamOpcode.SnapshotChunk, 'partial')

    send(options, TerminalStreamOpcode.Error, TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE)

    expect(options.terminalSnapshots.size).toBe(0)
    expect(listener).toHaveBeenCalledWith({
      type: 'snapshot-error',
      streamId: 42,
      reason: 'oversized',
      message: TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE
    })
  })

  it('discards a snapshot that exceeds the admission ceiling', () => {
    const listener = vi.fn()
    const options = makeOptions(listener)
    send(options, TerminalStreamOpcode.SnapshotStart, { kind: 'scrollback' })
    send(options, TerminalStreamOpcode.SnapshotChunk, 'x'.repeat(TERMINAL_SNAPSHOT_MAX_BYTES))
    send(options, TerminalStreamOpcode.SnapshotChunk, 'x')

    expect(options.terminalSnapshots.size).toBe(0)
    expect(listener).toHaveBeenCalledWith({
      type: 'snapshot-error',
      streamId: 42,
      reason: 'byte-limit'
    })
    send(options, TerminalStreamOpcode.SnapshotEnd, '')
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'scrollback' }))
  })

  it('discards snapshots that exceed the chunk-count bound', () => {
    const listener = vi.fn()
    const options = makeOptions(listener)
    send(options, TerminalStreamOpcode.SnapshotStart, { kind: 'scrollback' })
    for (let index = 0; index < TERMINAL_SNAPSHOT_MAX_CHUNKS; index += 1) {
      send(options, TerminalStreamOpcode.SnapshotChunk, '')
    }
    send(options, TerminalStreamOpcode.SnapshotChunk, '')

    expect(options.terminalSnapshots.size).toBe(0)
    expect(listener).toHaveBeenCalledWith({
      type: 'snapshot-error',
      streamId: 42,
      reason: 'chunk-limit'
    })
  })

  it('expires incomplete snapshots and releases their chunks', () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    const options = makeOptions(listener)
    send(options, TerminalStreamOpcode.SnapshotStart, { kind: 'scrollback' })
    send(options, TerminalStreamOpcode.SnapshotChunk, 'partial')

    vi.advanceTimersByTime(TERMINAL_SNAPSHOT_ASSEMBLY_TIMEOUT_MS)

    expect(options.terminalSnapshots.size).toBe(0)
    expect(listener).toHaveBeenCalledWith({
      type: 'snapshot-error',
      streamId: 42,
      reason: 'expired'
    })
  })

  it('replacing a snapshot clears the previous expiry and only emits the replacement', () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    const options = makeOptions(listener)
    send(options, TerminalStreamOpcode.SnapshotStart, { kind: 'scrollback' })
    send(options, TerminalStreamOpcode.SnapshotChunk, 'old')
    vi.advanceTimersByTime(TERMINAL_SNAPSHOT_ASSEMBLY_TIMEOUT_MS - 10)
    send(options, TerminalStreamOpcode.SnapshotStart, { kind: 'resized', seq: 2 })
    vi.advanceTimersByTime(11)
    send(options, TerminalStreamOpcode.SnapshotChunk, 'new')
    send(options, TerminalStreamOpcode.SnapshotEnd, '')

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'resized', seq: 2, serialized: 'new' })
    )
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'snapshot-error' }))
  })

  it('clears the expiry timer during stream cleanup', () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    const options = makeOptions(listener)
    send(options, TerminalStreamOpcode.SnapshotStart, { kind: 'scrollback' })
    clearTerminalSnapshot(options.terminalSnapshots, 42)
    vi.advanceTimersByTime(TERMINAL_SNAPSHOT_ASSEMBLY_TIMEOUT_MS)

    expect(options.terminalSnapshots.size).toBe(0)
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'snapshot-error' }))
  })
})
