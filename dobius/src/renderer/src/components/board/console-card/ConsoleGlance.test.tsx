// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConsoleGlance } from './ConsoleGlance'
import type { ConsoleMiniatureStyle } from './console-miniature'
import type { ConsoleScreen, MiniRun } from './console-output-tail'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const style: ConsoleMiniatureStyle = {
  fontSize: 14,
  fontFamily: 'monospace',
  lineHeightPx: 20,
  paddingX: 4,
  paddingY: 4,
  background: 'var(--term-bg)',
  foreground: 'var(--term-fg)'
}

type Props = React.ComponentProps<typeof ConsoleGlance>
const plainRun = (text: string): MiniRun => ({
  text,
  fg: { mode: 'default' },
  bg: { mode: 'default' },
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strike: false,
  invisible: false
})
const plain = (lines: string[] | null): ConsoleScreen | null =>
  lines === null ? null : { cols: 80, rows: 24, lines: lines.map((l) => (l ? [plainRun(l)] : [])) }

const base: Props = {
  title: 'Claude 2',
  screen: null,
  lastReply: null,
  style,
  // (108 - 2*4) / 20 = 5 rows fit.
  bodyHeight: 108,
  drawText: true
}

function render(props: Partial<Props>): HTMLElement {
  act(() => root.render(<ConsoleGlance {...base} {...props} />))
  const glance = container.querySelector<HTMLElement>('[data-board-console-glance]')
  if (!glance) {
    throw new Error('glance not rendered')
  }
  return glance
}

const rowsOf = (glance: HTMLElement): string[] =>
  Array.from(glance.children, (row) => row.textContent ?? '')

describe('ConsoleGlance', () => {
  it('draws the terminal at its own zoom-1 font, line height, padding and colors', () => {
    const glance = render({ screen: plain(['$ npm test']) })
    expect(glance.style.fontSize).toBe('14px')
    expect(glance.style.lineHeight).toBe('20px')
    expect(glance.style.paddingTop).toBe('4px')
    expect(glance.style.background).toContain('var(--term-bg)')
    expect(glance.style.color).toBe('var(--term-fg)')
    // Proportional miniature: no counter-scale transform, no status header.
    expect(glance.style.transform).toBe('')
    expect(glance.textContent).not.toContain('Working')
  })

  it('shows as many of the newest rows as fit the card, clipped not ellipsized', () => {
    const lines = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']
    const glance = render({ screen: plain(lines) })
    expect(rowsOf(glance)).toEqual(['r3', 'r4', 'r5', 'r6', 'r7'])
    const row = glance.firstElementChild as HTMLElement
    expect(row.className).toContain('whitespace-pre')
    expect(row.className).not.toContain('truncate')
    // A taller card shows more rows.
    expect(rowsOf(render({ screen: plain(lines), bodyHeight: 1000 }))).toHaveLength(7)
  })

  it('falls back to the last reply, then to an explicit empty state', () => {
    expect(
      render({ screen: plain([]), lastReply: 'All done.\nOpened PR #4' }).textContent
    ).toContain('Opened PR #4')
    expect(render({ screen: plain(null), lastReply: null }).textContent).toContain('No output yet')
  })

  it('draws only the terminal background when the card is too small for text to read', () => {
    const glance = render({ screen: plain(['x']), drawText: false })
    expect(glance.children).toHaveLength(0)
    expect(glance.style.background).toContain('var(--term-bg)')
  })

  it('is clickable for focus but never focusable itself', () => {
    const glance = render({ screen: plain(['x']) })
    expect(glance.hasAttribute('data-board-card-glance')).toBe(true)
    expect(glance.querySelector('[tabindex], button, input')).toBeNull()
  })

  it('draws colours and bold from the live theme and keeps the live column grid', () => {
    const red: MiniRun = { ...plainRun('FAIL'), fg: { mode: 'palette', index: 1 }, bold: true }
    const glance = render({
      screen: { cols: 50, rows: 5, lines: [[red, plainRun(' one broken')]] },
      style: { ...style, ansi: ['k', 'var(--ansi-red)', 'g'], fontWeightBold: 600 },
      bodyWidth: 515
    })
    const row = glance.querySelector<HTMLElement>('[data-glance-row]')
    const span = row?.querySelector('span')
    // Bold red draws in the bright slot (drawBoldTextInBrightColors); none given -> foreground.
    expect(span?.style.color).toBe('var(--term-fg)')
    expect(span?.style.fontWeight).toBe('600')
    // (515 - 2*4 - 7 gutter) / 50 cols = 10px per cell.
    expect(row?.style.letterSpacing).toBe('calc(10px - 1ch)')
    expect(row?.style.width).toBe('500px')
  })
})
