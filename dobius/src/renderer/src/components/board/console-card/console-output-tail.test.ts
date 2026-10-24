import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import {
  consoleTailLines,
  isDecorativeLine,
  sameLines,
  textTailLines,
  unframeLine,
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

describe('consoleTailLines', () => {
  it('returns the newest lines last, skipping trailing blank rows', () => {
    const buffer = fakeBuffer(['$ npm test', 'PASS a.test.ts', 'PASS b.test.ts', '', '   ', ''])
    expect(consoleTailLines(buffer, 2)).toEqual(['PASS a.test.ts', 'PASS b.test.ts'])
  })

  it('drops pure box-drawing rows and unframes bordered text', () => {
    const buffer = fakeBuffer([
      '● Reading src/app.ts',
      '╭──────────────────────────╮',
      '│ > fix the failing test   │',
      '╰──────────────────────────╯',
      '  ? for shortcuts'
    ])
    expect(consoleTailLines(buffer)).toEqual([
      '● Reading src/app.ts',
      '> fix the failing test',
      '  ? for shortcuts'
    ])
  })

  it('caps very long rows', () => {
    const buffer = fakeBuffer(['x'.repeat(1000)])
    expect(consoleTailLines(buffer)[0]).toHaveLength(240)
  })

  it('reads the visible screen from a real emulator, including the alternate screen', async () => {
    const term = new Terminal({ cols: 40, rows: 6, scrollback: 0, allowProposedApi: true })
    await writeAll(term, 'shell line\r\n\x1b[?1049h\x1b[H\x1b[1;32mTUI header\x1b[0m\r\nworking…')
    expect(consoleTailLines(term.buffer.active)).toEqual(['TUI header', 'working…'])
    term.dispose()
  })

  it('handles cursor-addressed output the way a user would see it', async () => {
    const term = new Terminal({ cols: 20, rows: 4, scrollback: 0, allowProposedApi: true })
    await writeAll(term, 'one\r\ntwo\r\nthree\x1b[2;1Hdos')
    expect(consoleTailLines(term.buffer.active)).toEqual(['one', 'dos', 'three'])
    term.dispose()
  })
})

describe('line helpers', () => {
  it('classifies decorative rows', () => {
    expect(isDecorativeLine('──────')).toBe(true)
    expect(isDecorativeLine('  ')).toBe(true)
    expect(isDecorativeLine('▐▛███▜▌')).toBe(true)
    expect(isDecorativeLine('Done in 3s')).toBe(false)
  })
  it('unframes a bordered row', () => {
    expect(unframeLine('│ hello │')).toBe('hello')
    expect(unframeLine('plain')).toBe('plain')
  })
  it('tails plain text replies', () => {
    expect(textTailLines('a\n\nb\r\nc  \n', 2)).toEqual(['b', 'c'])
  })
  it('compares line lists by value', () => {
    expect(sameLines(['a'], ['a'])).toBe(true)
    expect(sameLines(['a'], ['b'])).toBe(false)
    expect(sameLines(null, ['a'])).toBe(false)
    expect(sameLines(null, null)).toBe(true)
  })
})
