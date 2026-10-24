import { describe, expect, it } from 'vitest'
import { diagramBounds, diagramPngScale, diagramToSvg } from './diagram-png'

const shapes = [
  { id: 'a', x: 100, y: 50, w: 200, h: 80, shape: 'rect' as const, label: 'API <gw>' },
  { id: 'b', x: 400, y: 200, w: 120, h: 120, shape: 'ellipse' as const },
  { id: 'c', x: -50, y: 300, w: 100, h: 60, shape: 'diamond' as const, label: 'ok?' }
]

describe('diagramBounds', () => {
  it('is the union of every shape', () => {
    expect(diagramBounds(shapes)).toEqual({ x: -50, y: 50, w: 570, h: 310 })
  })
  it('is null for an empty diagram', () => {
    expect(diagramBounds([])).toBeNull()
    expect(diagramToSvg([], [])).toBeNull()
  })
})

describe('diagramToSvg', () => {
  it('sizes the canvas to the padded bounds and shifts shapes to the origin', () => {
    const out = diagramToSvg(shapes, [{ from: 'a', to: 'b', label: 'calls' }], 10)!
    expect(out.width).toBe(590)
    expect(out.height).toBe(330)
    // a: x 100 - (-50 - 10) = 160, y 50 - (50 - 10) = 10
    expect(out.svg).toContain('<rect x="160" y="10" width="200" height="80"')
    expect(out.svg).toContain('<ellipse cx="520" cy="220" rx="60" ry="60"')
    expect(out.svg).toContain('<polygon points="60,260 110,290 60,320 10,290"')
  })

  it('escapes labels and draws arrows only between known shapes', () => {
    const out = diagramToSvg(shapes, [
      { from: 'a', to: 'b', label: 'R&D' },
      { from: 'a', to: 'missing' }
    ])!
    expect(out.svg).toContain('API &lt;gw&gt;')
    expect(out.svg).toContain('R&amp;D')
    expect(out.svg.match(/<line /g)).toHaveLength(1)
    expect(out.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
  })
})

describe('diagramPngScale', () => {
  it('uses 2x for normal diagrams and shrinks huge ones under the cap', () => {
    expect(diagramPngScale(800, 600)).toBe(2)
    expect(diagramPngScale(8192, 100)).toBe(1)
    expect(diagramPngScale(16384, 100)).toBe(0.5)
  })
})
