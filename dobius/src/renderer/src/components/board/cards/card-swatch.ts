import type { BoardSwatch } from '@/store/slices/board'

export function swatchFill(swatch: BoardSwatch): string {
  return swatch === 'accent' ? 'var(--board-accent-tint)' : `var(--board-swatch-${swatch})`
}

export function swatchEdge(swatch: BoardSwatch): string {
  return `color-mix(in oklch, ${swatchFill(swatch)} 55%, var(--board-text))`
}

export const BOARD_SWATCHES: readonly BoardSwatch[] = [
  'yellow',
  'pink',
  'blue',
  'green',
  'purple',
  'accent'
]
