import { Terminal } from '@xterm/headless'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { withStableOscLinkIds } from './terminal-osc-link-ids'

vi.mock('@/lib/e2e-config', () => ({ e2eConfig: { exposeStore: false } }))

type XtermInternals = {
  _core: {
    _oscLinkService: { _dataByLinkId: Map<number, unknown> }
    buffer: { markers: unknown[] }
  }
}

const REDRAWS = 10_000
// One Ink-style repaint: rewrite two rows in place (EL + cursor up), the lower
// one carrying an id-less OSC 8 link, ending where it started.
const REDRAW_FRAME =
  '\x1b[2K\r  Read(\x1b]8;;file:///repo/src/foo.ts\x07src/foo.ts\x1b]8;;\x07) working\x1b[1A\x1b[2K\r header\r\n'

function linkCounts(term: Terminal): { links: number; markers: number } {
  const core = (term as unknown as XtermInternals)._core
  return { links: core._oscLinkService._dataByLinkId.size, markers: core.buffer.markers.length }
}

function parsed(term: Terminal): Promise<void> {
  return new Promise((resolve) => term.write('', resolve))
}

describe('withStableOscLinkIds', () => {
  it('gives id-less OSC 8 opens an id and leaves closes and other OSCs alone', () => {
    expect(withStableOscLinkIds('\x1b]8;;https://a.test\x07a\x1b]8;;\x07')).toBe(
      '\x1b]8;id=dobius;https://a.test\x07a\x1b]8;;\x07'
    )
    expect(withStableOscLinkIds('\x1b]8;;file:///x\x1b\\x\x1b]8;;\x1b\\')).toBe(
      '\x1b]8;id=dobius;file:///x\x1b\\x\x1b]8;;\x1b\\'
    )
    expect(withStableOscLinkIds('\x1b]8;id=mine;https://a.test\x07')).toBe(
      '\x1b]8;id=mine;https://a.test\x07'
    )
    expect(withStableOscLinkIds('\x1b]0;title\x07plain')).toBe('\x1b]0;title\x07plain')
  })
})

describe('terminal output OSC 8 retention', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps xterm link entries bounded when a TUI repaints the same link in place', async () => {
    vi.resetModules()
    const { writeTerminalOutput, flushTerminalOutput } =
      await import('./pane-terminal-output-scheduler')
    const term = new Terminal({ cols: 120, rows: 30, scrollback: 5000, allowProposedApi: true })
    try {
      term.write('prompt\r\n\r\n')
      for (let i = 0; i < REDRAWS; i++) {
        writeTerminalOutput(term, REDRAW_FRAME, { foreground: false })
        if (i % 500 === 499) {
          flushTerminalOutput(term)
        }
      }
      flushTerminalOutput(term)
      await parsed(term)

      // Before the fix this was 10,000 entries and 10,000 markers (one per repaint).
      expect(linkCounts(term)).toEqual({ links: 1, markers: 1 })
      const { cursorY, baseY } = term.buffer.active
      expect(term.buffer.active.getLine(baseY + cursorY)?.translateToString(true)).toContain(
        'src/foo.ts'
      )
    } finally {
      term.dispose()
    }
  }, 60_000)
})
