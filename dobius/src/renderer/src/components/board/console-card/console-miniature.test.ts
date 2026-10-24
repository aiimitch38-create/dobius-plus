import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/constants'
import { composeActiveTerminalTheme } from '@/components/terminal-pane/terminal-appearance'
import { getBuiltinTheme, resolveEffectiveTerminalAppearance } from '@/lib/terminal-theme'
import {
  consoleMiniatureStyle,
  miniatureCellBox,
  miniatureFitRows,
  miniatureRows,
  miniRunStyle,
  type ConsoleMiniatureStyle
} from './console-miniature'
import type { MiniRun } from './console-output-tail'

const style: ConsoleMiniatureStyle = {
  fontSize: 14,
  fontFamily: undefined,
  lineHeightPx: 16.8,
  paddingX: 4,
  paddingY: 4,
  background: 'var(--board-panel)',
  foreground: 'var(--board-text)'
}

describe('miniatureFitRows', () => {
  it('fits rows of the terminal line height inside the padded body', () => {
    // (360 - 8) / 16.8 = 20.95 -> 20 rows, the same count the live terminal shows.
    expect(miniatureFitRows(360, style)).toBe(20)
    expect(miniatureFitRows(10, style)).toBe(1)
    expect(miniatureFitRows(0, style)).toBe(0)
  })
})

describe('miniatureRows', () => {
  it('keeps the newest rows, like a terminal scrolled to the bottom', () => {
    expect(miniatureRows(['a', 'b', 'c'], 2)).toEqual(['b', 'c'])
    expect(miniatureRows(['a', 'b'], 5)).toEqual(['a', 'b'])
    expect(miniatureRows(['a', 'b'], 0)).toEqual(['a', 'b'])
  })
})

describe('consoleMiniatureStyle', () => {
  it('falls back to board tokens and xterm defaults before settings load', () => {
    expect(consoleMiniatureStyle(null)).toMatchObject({
      ansi: undefined,
      fontSize: 14,
      fontFamily: undefined,
      lineHeightPx: 14 * 1.2,
      paddingX: 4,
      paddingY: 4,
      background: 'var(--board-panel)',
      foreground: 'var(--board-text)'
    })
  })
  it('uses the live terminal theme colors and font settings', () => {
    const settings = {
      ...getDefaultSettings('/home/test'),
      theme: 'dark' as const,
      terminalFontSize: 12,
      terminalLineHeight: 1.5,
      terminalPaddingX: 10
    }
    const appearance = resolveEffectiveTerminalAppearance(settings, true)
    const theme = composeActiveTerminalTheme(
      appearance.theme ?? getBuiltinTheme(appearance.themeName),
      settings
    )
    const mini = consoleMiniatureStyle(settings, true)
    expect(theme?.background).toBeTruthy()
    expect(mini.background).toBe(theme?.background)
    expect(mini.foreground).toBe(theme?.foreground)
    expect(mini.fontSize).toBe(12)
    expect(mini.lineHeightPx).toBeCloseTo(12 * 1.2 * 1.5)
    expect(mini.paddingX).toBe(10)
    expect(mini.fontFamily).toBeTruthy()
    // The palette is the same theme the live xterm uses.
    expect(mini.ansi?.[1]).toBe(theme?.red)
    expect(mini.ansi?.[15]).toBe(theme?.brightWhite)
  })
})

describe('miniRunStyle', () => {
  const themed: ConsoleMiniatureStyle = {
    ...style,
    background: 'var(--bg)',
    foreground: 'var(--fg)',
    ansi: Array.from({ length: 16 }, (_, i) => `var(--ansi-${i})`),
    fontWeightBold: 500
  }
  const run = (over: Partial<MiniRun>): MiniRun => ({
    text: 'x',
    fg: { mode: 'default' },
    bg: { mode: 'default' },
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    strike: false,
    invisible: false,
    ...over
  })

  it('leaves default cells to the terminal colours', () => {
    expect(miniRunStyle(run({}), themed)).toEqual({})
  })

  it('maps palette 0-15 to the live theme, bold 0-7 to the bright slot', () => {
    expect(miniRunStyle(run({ fg: { mode: 'palette', index: 1 } }), themed).color).toBe(
      'var(--ansi-1)'
    )
    expect(
      miniRunStyle(run({ fg: { mode: 'palette', index: 1 }, bold: true }), themed)
    ).toMatchObject({ color: 'var(--ansi-9)', fontWeight: 500 })
    expect(miniRunStyle(run({ bg: { mode: 'palette', index: 12 } }), themed).backgroundColor).toBe(
      'var(--ansi-12)'
    )
  })

  it('computes the 256-colour cube and grey ramp, and truecolor', () => {
    expect(miniRunStyle(run({ fg: { mode: 'palette', index: 196 } }), themed).color).toBe(
      'rgb(255, 0, 0)'
    )
    expect(miniRunStyle(run({ fg: { mode: 'palette', index: 232 } }), themed).color).toBe(
      'rgb(8, 8, 8)'
    )
    expect(miniRunStyle(run({ fg: { mode: 'rgb', rgb: 0x0a0b0c } }), themed).color).toBe('#0a0b0c')
  })

  it('applies inverse, dim, italic, underline, strike and invisible', () => {
    expect(miniRunStyle(run({ inverse: true }), themed)).toMatchObject({
      color: 'var(--bg)',
      backgroundColor: 'var(--fg)'
    })
    expect(
      miniRunStyle(
        run({ dim: true, italic: true, underline: true, strike: true, invisible: true }),
        themed
      )
    ).toEqual({
      opacity: 0.5,
      fontStyle: 'italic',
      textDecoration: 'underline line-through',
      visibility: 'hidden'
    })
  })
})

describe('miniatureCellBox', () => {
  it('spreads the live columns across the body (minus padding and scrollbar gutter)', () => {
    expect(miniatureCellBox({ cols: 100, rows: 10 }, 1015, 0, { ...style, paddingX: 4 })).toEqual({
      cellWidthPx: 10,
      lineHeightPx: style.lineHeightPx
    })
  })
  it('falls back to natural glyph width while unmeasured', () => {
    expect(miniatureCellBox(null, 500, 200, style).cellWidthPx).toBeNull()
  })
})
