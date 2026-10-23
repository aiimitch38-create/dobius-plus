import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BOARD_CARD_STYLE,
  boardFillCss,
  boardInkCss,
  boardStrokeDashArray,
  sanitizeBoardCardStyle
} from './board-tool-style'

describe('sanitizeBoardCardStyle', () => {
  it('returns defaults for junk', () => {
    expect(sanitizeBoardCardStyle(null)).toEqual(DEFAULT_BOARD_CARD_STYLE)
    expect(sanitizeBoardCardStyle({ stroke: 'red', fill: 7, opacity: 'x' })).toEqual(
      DEFAULT_BOARD_CARD_STYLE
    )
  })

  it('keeps valid tokens and eyedropper hex, clamps opacity', () => {
    const style = sanitizeBoardCardStyle({
      stroke: '#A1B2C3',
      fill: 'green',
      strokeStyle: 'dotted',
      opacity: 400
    })
    expect(style).toMatchObject({
      stroke: '#A1B2C3',
      fill: 'green',
      strokeStyle: 'dotted',
      opacity: 100
    })
    expect(sanitizeBoardCardStyle({ opacity: -5 }).opacity).toBe(10)
    expect(sanitizeBoardCardStyle({ textFont: 'script' }).textFont).toBe('script')
    expect(sanitizeBoardCardStyle({ textFont: 'comic' }).textFont).toBe('sans')
    expect(sanitizeBoardCardStyle({ fillStyle: 'hachure' }).fillStyle).toBe('hachure')
    expect(sanitizeBoardCardStyle({ fillStyle: 'zigzag' }).fillStyle).toBe('solid')
  })

  it('rejects hex that is not 6 digits (no CSS injection through color)', () => {
    expect(sanitizeBoardCardStyle({ fill: '#fff;background:url(x)' }).fill).toBe('none')
  })
})

describe('CSS resolvers', () => {
  it('maps tokens to Board variables only', () => {
    expect(boardInkCss('text')).toBe('var(--board-text)')
    expect(boardInkCss('blue')).toContain('var(--board-swatch-blue)')
    expect(boardFillCss('none')).toBe('transparent')
    expect(boardFillCss('accent')).toBe('var(--board-accent-tint)')
    expect(boardFillCss('#123456')).toBe('#123456')
  })

  it('scales dashes with width', () => {
    expect(boardStrokeDashArray('solid', 3)).toBeUndefined()
    expect(boardStrokeDashArray('dashed', 2)).toBe('6 4')
    expect(boardStrokeDashArray('dotted', 2)).toBe('0 4')
  })
})
