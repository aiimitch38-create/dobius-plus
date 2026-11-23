import { describe, expect, it } from 'vitest'
import { HeadlessEmulator } from '../daemon/headless-emulator'
import { buildRenderedScreenRead, screenReadRowBudget } from './terminal-read-views'
import type { RuntimeTerminalScreenRead } from '../../shared/runtime-types'

const ESC = '\u001b'

// Ink-style redraw: erase the previous N-row frame bottom-up, then paint anew.
function eraseLines(count: number): string {
  let out = ''
  for (let index = 0; index < count; index += 1) {
    out += `${ESC}[2K${index < count - 1 ? `${ESC}[1A` : ''}`
  }
  return `${out}${ESC}[G`
}

/** A recorded-style Claude Code byte stream: static conversation output that
 *  scrolls into history, then a 3-row live region redrawn many times. */
function claudeLikeStream(): string {
  let out = ''
  for (let index = 1; index <= 40; index += 1) {
    out += `⏺ conversation line ${index}\r\n`
  }
  const frame = (seconds: number): string =>
    `✻ Waddling… (${seconds}s)\r\n╭ input ╮\r\n│ > Build ADAM quick hands`
  out += frame(1)
  for (let seconds = 2; seconds <= 43; seconds += 1) {
    // spinner frames also redraw the first row in place with CR + erase
    out += eraseLines(3) + frame(seconds)
    out += `\r${ESC}[1A${ESC}[1A${ESC}[2K✻ Waddling… (${seconds}s)${ESC}[1B${ESC}[1B`
  }
  return out
}

async function renderRead(
  data: string,
  opts: { cols?: number; rows?: number; scrollback?: number; limit?: number } = {}
): Promise<Extract<RuntimeTerminalScreenRead, { available: true }>> {
  const emulator = new HeadlessEmulator({
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    scrollback: opts.scrollback
  })
  try {
    await emulator.write(data)
    const read = buildRenderedScreenRead(
      emulator.getRenderedRows(screenReadRowBudget(opts.limit)),
      { limit: opts.limit }
    )
    if (!read.available) {
      throw new Error('expected available screen read')
    }
    return read
  } finally {
    emulator.dispose()
  }
}

describe('buildRenderedScreenRead', () => {
  it('renders a TUI redraw stream to clean ordered lines with no merged spinner fragments', async () => {
    const read = await renderRead(claudeLikeStream())
    const all = [...read.scrollback, ...read.screen]
    expect(all.slice(0, 40)).toEqual(
      Array.from({ length: 40 }, (_, index) => `⏺ conversation line ${index + 1}`)
    )
    expect(all.slice(40)).toEqual(['✻ Waddling… (43s)', '╭ input ╮', '│ > Build ADAM quick hands'])
    expect(all.filter((line) => line.includes('Waddling'))).toHaveLength(1)
    expect(read.screen.at(-1)).toBe('│ > Build ADAM quick hands')
    expect(read.limited).toBe(false)
    expect(read.scrollbackMayBeEvicted).toBe(false)
  })

  it('resolves carriage-return spinner redraws on one row', async () => {
    const read = await renderRead(
      `start\r\n${['|', '/', '-', '\\'].map((frame) => `\r${ESC}[2K${frame} working`).join('')}\r${ESC}[2Kdone\r\n`
    )
    expect([...read.scrollback, ...read.screen]).toEqual(['start', 'done'])
  })

  it('respects the line limit and flags older retained output', async () => {
    const data = Array.from({ length: 300 }, (_, index) => `line ${index + 1}`).join('\r\n')
    const read = await renderRead(data, { limit: 50 })
    const all = [...read.scrollback, ...read.screen]
    expect(all).toHaveLength(50)
    expect(all[0]).toBe('line 251')
    expect(all.at(-1)).toBe('line 300')
    expect(read.limited).toBe(true)
    expect(read.screen).toHaveLength(24)
    expect(read.scrollbackRowsRetained).toBe(276)
  })

  it('reports eviction when the mirror scrollback is at capacity', async () => {
    const data = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join('\r\n')
    const read = await renderRead(data, { rows: 5, scrollback: 10, limit: 500 })
    const all = [...read.scrollback, ...read.screen]
    expect(all[0]).toBe('line 86')
    expect(all.at(-1)).toBe('line 100')
    expect(read.scrollbackMayBeEvicted).toBe(true)
    expect(read.scrollbackCapacity).toBe(10)
  })

  it('rejoins soft-wrapped rows into one logical line', async () => {
    const long = 'abcdefghij'.repeat(5)
    const read = await renderRead(`${long}\r\nnext`, { cols: 20, rows: 6 })
    expect([...read.scrollback, ...read.screen]).toEqual([long, 'next'])
  })

  it('reads the alternate screen of a full-screen TUI', async () => {
    const read = await renderRead(
      `shell prompt\r\n${ESC}[?1049h${ESC}[H${ESC}[2Jtui header${ESC}[3;1Htui body`
    )
    expect(read.alternateScreen).toBe(true)
    expect(read.scrollback).toEqual([])
    expect(read.screen).toEqual(['tui header', '', 'tui body'])
  })

  it('places absolute-positioned text on its own row instead of merging it', async () => {
    const read = await renderRead(
      `${ESC}[H${ESC}[2JWaddling… (43s)${ESC}[5;1HBuild ADAM quick hands`
    )
    expect(read.screen).toEqual(['Waddling… (43s)', '', '', '', 'Build ADAM quick hands'])
  })

  it('passes through a history-incomplete reason', () => {
    const read = buildRenderedScreenRead(
      {
        rows: [{ text: 'x', wrapped: false }],
        firstReturnedRow: 0,
        totalRows: 1,
        firstScreenRow: 0,
        cursorRow: 0,
        cols: 80,
        screenRows: 1,
        alternateScreen: false,
        scrollbackCapacity: 5000
      },
      { historyIncomplete: 'not seeded' }
    )
    expect(read).toMatchObject({ available: true, historyIncomplete: 'not seeded', screen: ['x'] })
  })

  it('bounds total characters, dropping the oldest lines first', async () => {
    const data = Array.from({ length: 40 }, (_, index) => `${index}`.padEnd(70, '.')).join('\r\n')
    const emulator = new HeadlessEmulator({ cols: 80, rows: 24 })
    try {
      await emulator.write(data)
      const read = buildRenderedScreenRead(emulator.getRenderedRows(1000), { maxChars: 710 })
      if (!read.available) {
        throw new Error('expected available')
      }
      const all = [...read.scrollback, ...read.screen]
      expect(all).toHaveLength(10)
      expect(all.at(-1)?.startsWith('39')).toBe(true)
      expect(read.limited).toBe(true)
    } finally {
      emulator.dispose()
    }
  })
})
