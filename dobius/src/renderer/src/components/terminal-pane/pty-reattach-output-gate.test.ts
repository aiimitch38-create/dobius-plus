import { describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/headless'
import { createPtyReattachOutputGate } from './pty-reattach-output-gate'

const MAX_BUFFERED_REATTACH_OUTPUT_BYTES = 2 * 1024 * 1024

async function writeTerminal(terminal: Terminal, data: string): Promise<void> {
  await new Promise<void>((resolve) => terminal.write(data, resolve))
}

async function readTerminalText(terminal: Terminal): Promise<string> {
  const rows: string[] = []
  for (let index = 0; index < terminal.buffer.active.length; index += 1) {
    rows.push(terminal.buffer.active.getLine(index)?.translateToString(true) ?? '')
  }
  return rows.join('\n')
}

describe('PTY reattach output gate', () => {
  it('holds early data until replay is applied, then preserves later stream order', () => {
    const onData = vi.fn()
    const gate = createPtyReattachOutputGate(onData)
    const meta = { seq: 7, rawLength: 7, background: true }

    gate.onData('first\r\n', meta)
    expect(onData).not.toHaveBeenCalled()

    expect(gate.release()).toBe(false)
    gate.onData('second\r\n', { seq: 15, rawLength: 8 })

    expect(onData.mock.calls).toEqual([
      ['first\r\n', meta],
      ['second\r\n', { seq: 15, rawLength: 8 }]
    ])
  })

  it('drops buffered PTY text on overflow so arbitrary ANSI suffixes cannot be replayed', async () => {
    const onData = vi.fn()
    const gate = createPtyReattachOutputGate(onData)
    gate.onData('x'.repeat(MAX_BUFFERED_REATTACH_OUTPUT_BYTES - 3))
    gate.onData('\x1b[')
    gate.onData('31m')
    gate.onData('fresh tail')

    expect(gate.release()).toBe(true)
    expect(gate.overflowed()).toBe(true)
    expect(onData).not.toHaveBeenCalled()

    const terminal = new Terminal({ cols: 80, rows: 3 })
    try {
      await writeTerminal(terminal, 'authoritative snapshot: clean screen\r\n')
      const text = await readTerminalText(terminal)
      expect(text).toContain('authoritative snapshot: clean screen')
      expect(text).not.toContain('[31m')
      expect(text).not.toContain('\ufffd')
    } finally {
      terminal.dispose()
    }
  })

  it('drops a split OSC and keeps its UTF-8 byte budget exact', () => {
    const onData = vi.fn()
    const gate = createPtyReattachOutputGate(onData)
    gate.onData('x'.repeat(MAX_BUFFERED_REATTACH_OUTPUT_BYTES - 4))
    gate.onData('\x1b]')
    gate.onData('10;')
    gate.onData('rgb:ffff/ffff/ffff\x07')

    expect(gate.release()).toBe(true)
    expect(onData).not.toHaveBeenCalled()
  })

  it('uses a conservative byte cap for a surrogate pair split across callbacks', async () => {
    const onData = vi.fn()
    const gate = createPtyReattachOutputGate(onData)
    // Each callback independently charges an unpaired surrogate as U+FFFD (3 bytes).
    // The combined stream would encode to exactly 2 MiB, so this deliberately
    // conservative upper bound may request snapshot recovery one pair early.
    gate.onData('x'.repeat(MAX_BUFFERED_REATTACH_OUTPUT_BYTES - 4))
    gate.onData('\ud83d')
    gate.onData('\ude00')

    expect(gate.release()).toBe(true)
    expect(onData).not.toHaveBeenCalled()

    const terminal = new Terminal({ cols: 80, rows: 3 })
    try {
      await writeTerminal(terminal, 'authoritative snapshot 😀\r\n')
      const text = await readTerminalText(terminal)
      expect(text).toContain('authoritative snapshot 😀')
      expect(text).not.toContain('\ufffd')
    } finally {
      terminal.dispose()
    }
  })

  it('discards buffered bytes when the old PTY cannot be reattached', () => {
    const onData = vi.fn()
    const gate = createPtyReattachOutputGate(onData)

    gate.onData('stale session output')
    gate.discard()

    expect(onData).not.toHaveBeenCalled()
  })

  it('permanently ignores late data and release after discard', () => {
    const onData = vi.fn()
    const onOverflowData = vi.fn()
    const gate = createPtyReattachOutputGate(onData, { onOverflowData })
    gate.onData('held output')
    gate.discard()

    gate.onData('late output')
    expect(gate.release()).toBe(false)
    expect(gate.overflowed()).toBe(false)
    expect(onData).not.toHaveBeenCalled()
    expect(onOverflowData).not.toHaveBeenCalled()
  })

  it('subtracts consumed orphan-frame UTF-8 bytes from rawLength', () => {
    const onData = vi.fn()
    const gate = createPtyReattachOutputGate(onData, {
      onAfterOverflowData: () => 2
    })
    gate.onData('x'.repeat(MAX_BUFFERED_REATTACH_OUTPUT_BYTES + 1))
    gate.release()
    gate.onData('😀x', { seq: 10, rawLength: 5 })

    expect(onData).toHaveBeenCalledWith('x', { seq: 10, rawLength: 1 })
  })
})
