import { describe, expect, it } from 'vitest'
import { toExcalidraw } from './diagram-excalidraw'
import { buildDiagramRequest, layoutDiagram, parseDiagramLines } from './diagram-model'

const lines = (...rows: unknown[]): string =>
  `${rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`

describe('buildDiagramRequest', () => {
  it('names the file and is one line; custom needs a description', () => {
    const prompt = buildDiagramRequest('architecture', '', '.dobius/diagrams/a.jsonl')!
    expect(prompt).toContain('.dobius/diagrams/a.jsonl')
    expect(prompt).not.toContain('\n')
    expect(buildDiagramRequest('custom', '  ', 'x')).toBeNull()
    expect(buildDiagramRequest('custom', 'the auth\nflow', 'x')).toContain('the auth flow')
  })
})

describe('parseDiagramLines', () => {
  it('keeps first-seen order, skips junk, dupes and an unfinished last line', () => {
    const unfinished = '{"type":"node","id":"half'
    const complete = lines(
      { type: 'node', id: 'web', label: 'Web app', layer: 'Frontend' },
      'Sure! Here is the diagram:',
      { type: 'node', id: 'api', label: 'API', layer: 'Backend', shape: 'ellipse' },
      { type: 'node', id: 'web', label: 'dupe', layer: 'X' },
      { type: 'edge', from: 'web', to: 'api', label: 'calls' },
      { type: 'edge', from: 'web', to: 'api' },
      { type: 'edge', from: 'api', to: 'api' },
      { type: 'node', id: 'db', layer: 'Backend', shape: 'hexagon' }
    )
    const text = `${complete}${unfinished}`
    const d = parseDiagramLines(text)
    expect(d.nodes.map((n) => n.id)).toEqual(['web', 'api', 'db'])
    expect(d.nodes[2]).toMatchObject({ label: 'db', shape: 'rect' })
    expect(d.layers).toEqual(['Frontend', 'Backend'])
    expect(d.edges).toEqual([{ from: 'web', to: 'api', label: 'calls' }])
    expect(d.done).toBe(false)
    expect(parseDiagramLines(lines({ type: 'done' })).done).toBe(true)
  })
})

describe('layoutDiagram', () => {
  it('puts layers in columns and is stable as nodes stream in', () => {
    const d = parseDiagramLines(
      lines(
        { type: 'node', id: 'a', layer: 'L1' },
        { type: 'node', id: 'b', layer: 'L2' },
        { type: 'node', id: 'c', layer: 'L1' }
      )
    )
    const first = layoutDiagram(
      { nodes: d.nodes.slice(0, 2), layers: d.layers },
      { x: 0, y: 0 },
      'mono'
    )
    const full = layoutDiagram(d, { x: 0, y: 0 }, 'auto')
    const pos = (l: typeof full, id: string) => l.nodes.find((n) => n.nodeId === id)!.card
    expect(pos(first, 'a').x).toBe(pos(full, 'a').x)
    expect(pos(first, 'a').y).toBe(pos(full, 'a').y)
    expect(pos(full, 'c').x).toBe(pos(full, 'a').x)
    expect(pos(full, 'c').y).toBeGreaterThan(pos(full, 'a').y)
    expect(pos(full, 'b').x).toBeGreaterThan(pos(full, 'a').x)
    expect(full.layers.map((l) => l.layer)).toEqual(['L1', 'L2'])
    const card = pos(first, 'a')
    expect(card.kind === 'shape' && card.style?.fill).toBe('none')
  })
})

describe('toExcalidraw', () => {
  it('exports shapes, labels and arrows between known shapes', () => {
    const scene = JSON.parse(
      toExcalidraw(
        [
          { id: 'a', x: 0, y: 0, w: 100, h: 50, shape: 'rect', label: 'A' },
          { id: 'b', x: 300, y: 0, w: 100, h: 50, shape: 'diamond' }
        ],
        [
          { from: 'a', to: 'b' },
          { from: 'a', to: 'gone' }
        ]
      )
    )
    expect(scene.type).toBe('excalidraw')
    expect(scene.elements.map((e: { type: string }) => e.type)).toEqual([
      'rectangle',
      'text',
      'diamond',
      'arrow'
    ])
  })
})

describe('diagram starters and effort', () => {
  it('every starter is a connected diagram whose edges point at real nodes', async () => {
    const { DIAGRAM_STARTERS, diagramStarter } = await import('./diagram-starters')
    for (const id of DIAGRAM_STARTERS) {
      const d = diagramStarter(id)
      const ids = new Set(d.nodes.map((n) => n.id))
      expect(d.edges.length).toBeGreaterThan(0)
      expect(d.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true)
      expect(layoutDiagram(d, { x: 0, y: 0 }, 'mono', false).layers).toEqual([])
    }
  })

  it('effort sets the node budget', () => {
    expect(buildDiagramRequest('architecture', '', 'f', 'quick')).toContain('at most 12 nodes')
    expect(buildDiagramRequest('architecture', '', 'f', 'thorough')).toContain('at most 40 nodes')
  })
})
