// Diagrams tool, pure parts: the request sent to an agent, the JSON-lines format
// it streams back, a stable layered layout, and Excalidraw export.
import { translate } from '@/i18n/i18n'
import type { BoardSwatch, NewBoardCard } from '@/store/slices/board'
import type { BoardCardStyle } from '../board-tool-panels/board-tool-style'
import { DEFAULT_BOARD_CARD_STYLE } from '../board-tool-panels/board-tool-style'

export type DiagramTemplateId =
  | 'architecture'
  | 'user-flow'
  | 'data-flow'
  | 'component-map'
  | 'request-lifecycle'
  | 'state-machine'
  | 'custom'
export type DiagramColorMode = 'mono' | 'auto'
export type DiagramEffort = 'quick' | 'balanced' | 'thorough'

const EFFORT_NODES: Record<DiagramEffort, number> = { quick: 12, balanced: 25, thorough: 40 }
export type DiagramShape = 'rect' | 'ellipse' | 'diamond'

export const DIAGRAM_TEMPLATES: readonly DiagramTemplateId[] = [
  'architecture',
  'user-flow',
  'data-flow',
  'component-map',
  'request-lifecycle',
  'state-machine',
  'custom'
]

const TEMPLATE_ASK: Record<Exclude<DiagramTemplateId, 'custom'>, string> = {
  architecture:
    'the system architecture: services, apps, stores and external systems, and how they connect',
  'user-flow': 'the primary user flow: the main screens or steps a user goes through, in order',
  'data-flow':
    'the data flow: where data comes from, how it is transformed, and where it is stored',
  'component-map': 'a component map: the main UI or code components and which ones use which',
  'request-lifecycle': 'the lifecycle of a typical request, from the caller to the response',
  'state-machine': 'the core state machine: the main states and the events that move between them'
}

export function diagramTemplateLabel(id: DiagramTemplateId): string {
  switch (id) {
    case 'architecture':
      return translate('board.diagram.template.architecture', 'System architecture')
    case 'user-flow':
      return translate('board.diagram.template.userFlow', 'Primary user flow')
    case 'data-flow':
      return translate('board.diagram.template.dataFlow', 'Data flow')
    case 'component-map':
      return translate('board.diagram.template.componentMap', 'Component map')
    case 'request-lifecycle':
      return translate('board.diagram.template.requestLifecycle', 'Request lifecycle')
    case 'state-machine':
      return translate('board.diagram.template.stateMachine', 'Core state machine')
    case 'custom':
      return translate('board.diagram.template.custom', 'Describe your own')
  }
}

/** One-line request for the agent, or null when a custom description is empty. */
export function buildDiagramRequest(
  template: DiagramTemplateId,
  description: string,
  relativeFile: string,
  effort: DiagramEffort = 'balanced'
): string | null {
  const ask =
    template === 'custom' ? description.replace(/\s+/g, ' ').trim() : TEMPLATE_ASK[template]
  if (!ask) {
    return null
  }
  return (
    `Draw a diagram of ${ask} for this repository. Read the code first. ` +
    `Write it to ${relativeFile} (create folders as needed) as JSON Lines, appending one line as soon as you decide it: ` +
    `{"type":"node","id":"short-id","label":"Short label","layer":"Layer name","shape":"rect|ellipse|diamond"} ` +
    `and {"type":"edge","from":"id","to":"id","label":"optional verb"}. ` +
    `Group nodes into 2 to 5 layers, at most ${EFFORT_NODES[effort]} nodes, write every node before edges that use it, ` +
    `and end with {"type":"done"}. Do not write anything else to that file.`
  )
}

export type DiagramNode = { id: string; label: string; layer: string; shape: DiagramShape }
export type DiagramEdge = { from: string; to: string; label?: string }
export type ParsedDiagram = {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  layers: string[]
  done: boolean
}

export const MAX_DIAGRAM_NODES = 60
const MAX_DIAGRAM_EDGES = 150
const SHAPES: readonly DiagramShape[] = ['rect', 'ellipse', 'diamond']
const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

/**
 * Tolerant parse of the streamed file: skips bad lines and an unfinished last
 * line, keeps first-seen order (so the layout of drawn nodes never shifts).
 */
export function parseDiagramLines(text: string): ParsedDiagram {
  const lines = text.split('\n')
  if (!text.endsWith('\n')) {
    lines.pop()
  }
  const nodes: DiagramNode[] = []
  const edges: DiagramEdge[] = []
  const layers: string[] = []
  const ids = new Set<string>()
  const edgeKeys = new Set<string>()
  let done = false
  for (const line of lines) {
    let raw: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object') {
        continue
      }
      raw = parsed as Record<string, unknown>
    } catch {
      continue // a stray non-JSON line from the agent; the rest still draws
    }
    if (raw.type === 'done') {
      done = true
    } else if (raw.type === 'node' && nodes.length < MAX_DIAGRAM_NODES) {
      const id = str(raw.id, 80)
      if (!id || ids.has(id)) {
        continue
      }
      const layer = str(raw.layer, 60) ?? translate('board.diagram.defaultLayer', 'Main')
      if (!layers.includes(layer)) {
        layers.push(layer)
      }
      ids.add(id)
      nodes.push({
        id,
        label: str(raw.label, 120) ?? id,
        layer,
        shape: SHAPES.includes(raw.shape as DiagramShape) ? (raw.shape as DiagramShape) : 'rect'
      })
    } else if (raw.type === 'edge' && edges.length < MAX_DIAGRAM_EDGES) {
      const from = str(raw.from, 80)
      const to = str(raw.to, 80)
      const key = `${from}\u0001${to}`
      if (from && to && from !== to && !edgeKeys.has(key)) {
        edgeKeys.add(key)
        const label = str(raw.label, 60)
        edges.push(label ? { from, to, label } : { from, to })
      }
    }
  }
  return { nodes, edges, layers, done }
}

const NODE_W = 200
const NODE_H = 84
const COL_GAP = 120
const ROW_GAP = 36
const HEADER_H = 44
const LAYER_SWATCHES: readonly BoardSwatch[] = [
  'blue',
  'green',
  'purple',
  'yellow',
  'pink',
  'accent'
]

export type DiagramPlacement = { nodeId: string; card: NewBoardCard }
export type DiagramLayerPlacement = { layer: string; card: NewBoardCard }

function nodeStyle(mode: DiagramColorMode, layerIndex: number): BoardCardStyle {
  return mode === 'mono'
    ? { ...DEFAULT_BOARD_CARD_STYLE, fill: 'none', sloppiness: 'architect' }
    : {
        ...DEFAULT_BOARD_CARD_STYLE,
        fill: LAYER_SWATCHES[layerIndex % LAYER_SWATCHES.length],
        sloppiness: 'architect'
      }
}

/** Layers are columns (first-seen order), nodes stack inside their column. */
export function layoutDiagram(
  diagram: Pick<ParsedDiagram, 'nodes' | 'layers'>,
  origin: { x: number; y: number },
  mode: DiagramColorMode,
  /** Starter shapes skip the layer titles; each column is just a step. */
  headers = true
): { nodes: DiagramPlacement[]; layers: DiagramLayerPlacement[] } {
  const headerH = headers ? HEADER_H : 0
  const rowInLayer = new Map<string, number>()
  const columnX = (layerIndex: number): number => origin.x + layerIndex * (NODE_W + COL_GAP)
  const nodes = diagram.nodes.map((node) => {
    const layerIndex = diagram.layers.indexOf(node.layer)
    const row = rowInLayer.get(node.layer) ?? 0
    rowInLayer.set(node.layer, row + 1)
    const card: NewBoardCard = {
      kind: 'shape',
      shape: node.shape,
      fill: 'accent',
      label: node.label,
      style: nodeStyle(mode, layerIndex),
      title: node.label,
      x: columnX(layerIndex),
      y: origin.y + headerH + row * (NODE_H + ROW_GAP),
      w: NODE_W,
      h: NODE_H
    }
    return { nodeId: node.id, card }
  })
  const layers = (headers ? diagram.layers : []).map((layer, i) => ({
    layer,
    card: {
      kind: 'text' as const,
      text: layer,
      title: layer,
      x: columnX(i),
      y: origin.y,
      w: NODE_W,
      h: HEADER_H - 8
    }
  }))
  return { nodes, layers }
}

/** Footprint of a finished layout, so the caller can centre it in view. */
export function diagramSize(layerCount: number, tallestLayer: number): { w: number; h: number } {
  const cols = Math.max(1, layerCount)
  return {
    w: cols * NODE_W + (cols - 1) * COL_GAP,
    h: HEADER_H + Math.max(1, tallestLayer) * (NODE_H + ROW_GAP)
  }
}
