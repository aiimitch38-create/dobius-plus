import { describe, expect, it } from 'vitest'
import type { BoardCard } from '@/store/slices/board'
import { diagramPlacement, diagramScope } from './diagram-board-scope'

const shape = (id: string, x = 0, y = 0): BoardCard =>
  ({
    id,
    kind: 'shape',
    shape: 'rect',
    fill: 'blue',
    x,
    y,
    w: 100,
    h: 60,
    z: 1,
    title: ''
  }) as BoardCard
const note = (id: string, x: number, y: number, w = 400, h = 300): BoardCard =>
  ({ id, kind: 'note', text: '', color: 'yellow', x, y, w, h, z: 1, title: '' }) as BoardCard

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('diagramPlacement', () => {
  const screen = { w: 1600, h: 1000 }
  const viewport = { x: 0, y: 0, zoom: 1 }

  it('puts a starter in a clear spot, never on top of existing cards', () => {
    const cards = [note('a', 96, 72, 700, 500)]
    const size = { w: 500, h: 300 }
    const { origin } = diagramPlacement({ cards, viewport }, size, screen)
    expect(overlaps({ ...origin, ...size }, cards[0])).toBe(false)
  })

  it('pans to reveal the diagram when the view is full', () => {
    const cards = [note('full', 0, 0, 2000, 2000)]
    const size = { w: 500, h: 300 }
    const placed = diagramPlacement({ cards, viewport }, size, screen)
    expect(overlaps({ ...placed.origin, ...size }, cards[0])).toBe(false)
    expect(placed.viewport).not.toBe(viewport)
    const left = placed.origin.x * placed.viewport.zoom + placed.viewport.x
    expect(left).toBeLessThan(screen.w)
  })
})

describe('diagramScope', () => {
  const cards = [shape('s1'), shape('s2'), shape('s3'), note('n', 500, 500)]
  const connectors = [
    { id: 'k1', fromCardId: 's1', toCardId: 's2', label: 'calls' },
    { id: 'k2', fromCardId: 's2', toCardId: 's3' },
    { id: 'k3', fromCardId: 's3', toCardId: 'n' }
  ]

  it('exports the latest drawing when its cards are still on the board', () => {
    const scope = diagramScope(cards, connectors, new Set(['s1', 's2']))
    expect(scope.shapes.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(scope.arrows).toEqual([{ from: 's1', to: 's2', label: 'calls' }])
  })

  it('exports every shape on the board for a diagram with no live job', () => {
    const scope = diagramScope(cards, connectors, null)
    expect(scope.shapes.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(scope.arrows.map((a) => `${a.from}>${a.to}`)).toEqual(['s1>s2', 's2>s3'])
    // A job whose cards were all deleted falls back to the whole board too.
    expect(diagramScope(cards, connectors, new Set(['gone'])).shapes).toHaveLength(3)
  })
})
