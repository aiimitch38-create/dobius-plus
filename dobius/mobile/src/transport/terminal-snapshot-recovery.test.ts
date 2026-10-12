import { describe, expect, it, vi } from 'vitest'
import {
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
  TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE
} from './terminal-stream-protocol'
import { handleTerminalBinaryFrame } from './rpc-client-terminal-binary-frame'
import {
  initializeTerminalAfterOversizedSnapshot,
  markOversizedSnapshotAwaitingGeometry,
  shouldRetryTerminalSnapshot
} from './terminal-snapshot-recovery'

describe('terminal snapshot recovery', () => {
  it('allows one retry until a valid snapshot resets the per-terminal budget', () => {
    const attempts = new Map<string, number>()

    expect(shouldRetryTerminalSnapshot(attempts, 'terminal-1')).toBe(true)
    expect(shouldRetryTerminalSnapshot(attempts, 'terminal-1')).toBe(false)
    expect(shouldRetryTerminalSnapshot(attempts, 'terminal-2')).toBe(true)

    attempts.delete('terminal-1')
    expect(shouldRetryTerminalSnapshot(attempts, 'terminal-1')).toBe(true)
  })

  it('does not retry a producer-declared oversized snapshot', () => {
    const attempts = new Map<string, number>()

    expect(shouldRetryTerminalSnapshot(attempts, 'terminal-1', 'oversized')).toBe(false)
    expect(attempts.has('terminal-1')).toBe(false)
  })

  it('initializes a live terminal after an oversized initial snapshot is refused', () => {
    const pending = new Set(['terminal-1'])
    const init = vi.fn()

    expect(initializeTerminalAfterOversizedSnapshot(pending, 'terminal-1', { init }, 91, 38)).toBe(
      true
    )
    expect(init).toHaveBeenCalledWith(91, 38, '', false)
    expect(pending.has('terminal-1')).toBe(false)
  })

  it('initializes before writing live output after an oversized cold attach', () => {
    const pending = new Set<string>()
    const initialized = new Set<string>()
    const warningTerminals = new Set<string>()
    const attempts = new Map<string, number>()
    const order: string[] = []
    const terminal = {
      init: vi.fn(() => order.push('init')),
      resize: vi.fn(),
      write: vi.fn(() => order.push('write'))
    }
    const listeners = new Map<number, (result: unknown) => void>([
      [
        7,
        (result: unknown) => {
          const event = result as Record<string, unknown>
          if (event.type === 'snapshot-error' && event.reason === 'oversized') {
            warningTerminals.add('terminal-1')
            markOversizedSnapshotAwaitingGeometry(
              pending,
              'terminal-1',
              initialized.has('terminal-1')
            )
            expect(shouldRetryTerminalSnapshot(attempts, 'terminal-1', 'oversized')).toBe(false)
          } else if (event.type === 'resized') {
            if (
              initializeTerminalAfterOversizedSnapshot(
                pending,
                'terminal-1',
                terminal,
                event.cols as number,
                event.rows as number
              )
            ) {
              initialized.add('terminal-1')
            } else {
              terminal.resize(event.cols as number, event.rows as number)
            }
          } else if (event.type === 'data') {
            terminal.write(event.chunk as string)
          }
        }
      ]
    ])
    const handle = (opcode: TerminalStreamOpcode, payload = new Uint8Array()) =>
      handleTerminalBinaryFrame(
        encodeTerminalStreamFrame({ opcode, streamId: 7, seq: order.length, payload }),
        {
          terminalSnapshots: new Map(),
          getListener: (streamId) => listeners.get(streamId),
          recordValidatedInboundTraffic: vi.fn()
        }
      )

    listeners.get(7)?.({ type: 'subscribed', cols: 91, rows: 38 })
    handle(
      TerminalStreamOpcode.Error,
      new TextEncoder().encode(TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE)
    )
    handle(
      TerminalStreamOpcode.Resized,
      new TextEncoder().encode(JSON.stringify({ cols: 91, rows: 38, displayMode: 'auto' }))
    )
    handle(TerminalStreamOpcode.Output, new TextEncoder().encode('prompt> '))

    expect(warningTerminals.has('terminal-1')).toBe(true)
    expect(initialized.has('terminal-1')).toBe(true)
    expect(terminal.init).toHaveBeenCalledWith(91, 38, '', false)
    expect(terminal.write).toHaveBeenCalledWith('prompt> ')
    expect(order).toEqual(['init', 'write'])
  })

  it('keeps oversized initialization pending until a terminal view is mounted', () => {
    const pending = new Set(['terminal-1'])

    expect(initializeTerminalAfterOversizedSnapshot(pending, 'terminal-1', undefined, 91, 38)).toBe(
      false
    )
    expect(pending.has('terminal-1')).toBe(true)
  })

  it('preserves an existing terminal after an oversized reflow snapshot', () => {
    const pending = new Set<string>()
    const initialized = new Set(['terminal-1'])
    const terminal = { init: vi.fn(), resize: vi.fn() }

    markOversizedSnapshotAwaitingGeometry(pending, 'terminal-1', initialized.has('terminal-1'))
    const initializedFromFallback = initializeTerminalAfterOversizedSnapshot(
      pending,
      'terminal-1',
      terminal,
      91,
      38
    )
    if (!initializedFromFallback) {
      terminal.resize(91, 38)
    }

    expect(pending.has('terminal-1')).toBe(false)
    expect(terminal.init).not.toHaveBeenCalled()
    expect(terminal.resize).toHaveBeenCalledWith(91, 38)
  })
})
