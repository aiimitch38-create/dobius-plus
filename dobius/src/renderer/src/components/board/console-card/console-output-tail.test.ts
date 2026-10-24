import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import {
  consoleScreenRows,
  consoleScreenRuns,
  sameLines,
  textTailLines,
  type TailBuffer
} from './console-output-tail'

function fakeBuffer(rows: string[]): TailBuffer {
  return {
    length: rows.length,
    getLine: (y) =>
      y < rows.length
        ? { translateToString: (trimRight) => (trimRight ? rows[y].trimEnd() : rows[y]) }
        : undefined
  }
}

function writeAll(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

describe('consoleScreenRows', () => {
  it('keeps every row as the terminal shows it, dropping only trailing blank rows', () => {
    const buffer = fakeBuffer(['$ npm test', '', 'PASS a.test.ts', '', '   ', ''])
    expect(consoleScreenRows(buffer)).toEqual(['$ npm test', '', 'PASS a.test.ts'])
  })

  it('keeps box-drawing frames, so the miniature looks like the real TUI', () => {
    const rows = ['╭────────╮', '│ > fix  │', '╰────────╯']
    expect(consoleScreenRows(fakeBuffer(rows))).toEqual(rows)
  })

  it('caps very long rows', () => {
    expect(consoleScreenRows(fakeBuffer(['x'.repeat(1000)]))[0]).toHaveLength(400)
  })

  it('reads the visible screen from a real emulator, including the alternate screen', async () => {
    const term = new Terminal({ cols: 40, rows: 6, scrollback: 0, allowProposedApi: true })
    await writeAll(term, 'shell line\r\n\x1b[?1049h\x1b[H\x1b[1;32mTUI header\x1b[0m\r\nworking…')
    expect(consoleScreenRows(term.buffer.active)).toEqual(['TUI header', 'working…'])
    term.dispose()
  })

  it('handles cursor-addressed output the way a user would see it', async () => {
    const term = new Terminal({ cols: 20, rows: 4, scrollback: 0, allowProposedApi: true })
    await writeAll(term, 'one\r\ntwo\r\nthree\x1b[2;1Hdos')
    expect(consoleScreenRows(term.buffer.active)).toEqual(['one', 'dos', 'three'])
    term.dispose()
  })
})

describe('line helpers', () => {
  it('tails plain text replies, keeping inner blank lines', () => {
    expect(textTailLines('a\n\nb\r\nc  \n', 3)).toEqual(['', 'b', 'c'])
    expect(textTailLines('a\nb', 0)).toEqual(['a', 'b'])
  })
  it('compares line lists by value', () => {
    expect(sameLines(['a'], ['a'])).toBe(true)
    expect(sameLines(['a'], ['b'])).toBe(false)
    expect(sameLines(null, ['a'])).toBe(false)
    expect(sameLines(null, null)).toBe(true)
  })
})

describe('consoleScreenRuns', () => {
  it('reads colours (palette, 256, truecolor) and attributes per run', async () => {
    const term = new Terminal({ cols: 40, rows: 4, allowProposedApi: true })
    await writeAll(
      term,
      '\x1b[31mFAIL\x1b[0m ok\r\n' +
        '\x1b[1;38;5;208mhot\x1b[0m\r\n' +
        '\x1b[38;2;1;2;3;48;5;4;3;4mrgb\x1b[0m\r\n' +
        '\x1b[2;7;9mx\x1b[0m'
    )
    const rows = consoleScreenRuns(term.buffer.active, term.cols)
    expect(rows[0]).toMatchObject([
      { text: 'FAIL', fg: { mode: 'palette', index: 1 }, bold: false },
      { text: ' ok', fg: { mode: 'default' } }
    ])
    expect(rows[1]).toMatchObject([
      { text: 'hot', fg: { mode: 'palette', index: 208 }, bold: true }
    ])
    expect(rows[2]).toMatchObject([
      {
        text: 'rgb',
        fg: { mode: 'rgb', rgb: 0x010203 },
        bg: { mode: 'palette', index: 4 },
        italic: true,
        underline: true
      }
    ])
    expect(rows[3]).toMatchObject([{ text: 'x', dim: true, inverse: true, strike: true }])
    term.dispose()
  })

  it('cuts rows at the terminal columns and drops trailing blank rows', async () => {
    const term = new Terminal({ cols: 10, rows: 5, allowProposedApi: true })
    await writeAll(term, 'abcdefghijKLM\r\n')
    const rows = consoleScreenRuns(term.buffer.active, term.cols)
    expect(rows.map((r) => r.map((run) => run.text).join(''))).toEqual(['abcdefghij', 'KLM'])
    term.dispose()
  })
})
