import type { BoardSwatch } from '@/store/slices/board'
import type { BoardPreset } from './board-preset'
import type { PresetDefinition } from './preset-catalog'
import { placePreset, type Rect } from './preset-placement'

/** What the preview draws: colored console tiles, neutral extras, links from the orchestrator. */
export type DiagramModel = {
  tiles: {
    rect: Rect
    color: BoardSwatch | null
    kind: 'console' | 'orchestrator' | 'kanban' | 'web' | 'other'
  }[]
  /** Group outlines (bounding boxes of each lane's consoles). */
  frames: { rect: Rect; color: BoardSwatch }[]
  orchestrator: Rect | null
}

function bbox(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) {
    return null
  }
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y
  }
}

export function catalogDiagram(preset: PresetDefinition): DiagramModel {
  const placement = placePreset(preset, { x: 0, y: 0 })
  const tiles: DiagramModel['tiles'] = []
  const frames: DiagramModel['frames'] = []
  preset.lanes.forEach((lane, i) => {
    for (const rect of placement.consoles[i]) {
      tiles.push({ rect, color: lane.color, kind: 'console' })
    }
    const frame = bbox(placement.consoles[i])
    if (frame) {
      frames.push({ rect: frame, color: lane.color })
    }
  })
  for (const e of placement.extras) {
    tiles.push({ rect: e.rect, color: null, kind: e.kind })
  }
  return {
    tiles,
    frames,
    orchestrator: placement.extras.find((e) => e.kind === 'orchestrator')?.rect ?? null
  }
}

export function userDiagram(preset: BoardPreset): DiagramModel {
  const colorOf = new Map(
    preset.groups.flatMap((g) => g.cardIds.map((id) => [id, g.color] as const))
  )
  const tiles: DiagramModel['tiles'] = preset.cards.map((c) => ({
    rect: { x: c.x, y: c.y, w: c.w, h: c.h },
    color: colorOf.get(c.id) ?? null,
    kind:
      c.kind === 'console' || c.kind === 'orchestrator' || c.kind === 'kanban' || c.kind === 'web'
        ? c.kind
        : 'other'
  }))
  const frames = preset.groups.flatMap((g) => {
    const rect = bbox(preset.cards.filter((c) => g.cardIds.includes(c.id)))
    return rect ? [{ rect, color: g.color }] : []
  })
  const orch = preset.cards.find((c) => c.kind === 'orchestrator')
  return {
    tiles,
    frames,
    orchestrator: orch ? { x: orch.x, y: orch.y, w: orch.w, h: orch.h } : null
  }
}

/** viewBox covering every tile with a margin. */
export function diagramViewBox(model: DiagramModel): string {
  const all = bbox([...model.tiles.map((t) => t.rect), ...model.frames.map((f) => f.rect)])
  if (!all) {
    return '0 0 100 60'
  }
  const pad = Math.max(all.w, all.h) * 0.06
  return `${all.x - pad} ${all.y - pad} ${all.w + pad * 2} ${all.h + pad * 2}`
}
