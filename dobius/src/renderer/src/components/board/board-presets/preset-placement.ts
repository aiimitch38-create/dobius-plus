import type { PresetDefinition, PresetExtra } from './preset-catalog'

// Pure world-space layout for a catalog preset. The same rects drive the
// studio's preview diagram and the cards Deploy places, so what you see is
// what lands on the board.

export type Rect = { x: number; y: number; w: number; h: number }

export const PRESET_CONSOLE = { w: 640, h: 400 }
export const PRESET_EXTRA_SIZE: Record<PresetExtra['kind'], { w: number; h: number }> = {
  orchestrator: { w: 360, h: 460 },
  kanban: { w: 720, h: 380 },
  web: { w: 900, h: 600 }
}
const CONSOLE_GAP = 32
// Why: GroupFrame draws a 24px frame around its members; this keeps frames apart.
const BLOCK_GAP = 140
const ORCHESTRATOR_GAP = 200
const MAX_GROUP_COLUMNS = 2

export type PresetPlacement = {
  /** consoles[laneIndex][slot] */
  consoles: Rect[][]
  extras: { kind: PresetExtra['kind']; rect: Rect }[]
}

type Block = { w: number; h: number; place: (x: number, y: number) => void }

export function placePreset(
  preset: Pick<PresetDefinition, 'lanes' | 'extras'>,
  center: { x: number; y: number }
): PresetPlacement {
  const consoles: Rect[][] = preset.lanes.map(() => [])
  const extras: PresetPlacement['extras'] = []

  const laneBlock = (laneIndex: number): Block => {
    const count = preset.lanes[laneIndex].count
    const cols = Math.min(MAX_GROUP_COLUMNS, Math.max(1, count))
    const rows = Math.ceil(count / cols)
    return {
      w: cols * PRESET_CONSOLE.w + (cols - 1) * CONSOLE_GAP,
      h: rows * PRESET_CONSOLE.h + (rows - 1) * CONSOLE_GAP,
      place: (x, y) => {
        for (let slot = 0; slot < count; slot += 1) {
          consoles[laneIndex].push({
            x: x + (slot % cols) * (PRESET_CONSOLE.w + CONSOLE_GAP),
            y: y + Math.floor(slot / cols) * (PRESET_CONSOLE.h + CONSOLE_GAP),
            ...PRESET_CONSOLE
          })
        }
      }
    }
  }

  // The kanban and preview stack in a central spine between the crews.
  const spineKinds = preset.extras.filter((e) => e.kind !== 'orchestrator').map((e) => e.kind)
  const spine: Block | null =
    spineKinds.length === 0
      ? null
      : {
          w: Math.max(...spineKinds.map((k) => PRESET_EXTRA_SIZE[k].w)),
          h:
            spineKinds.reduce((h, k) => h + PRESET_EXTRA_SIZE[k].h, 0) +
            (spineKinds.length - 1) * CONSOLE_GAP,
          place: (x, y) => {
            let top = y
            const width = Math.max(...spineKinds.map((k) => PRESET_EXTRA_SIZE[k].w))
            for (const kind of spineKinds) {
              const size = PRESET_EXTRA_SIZE[kind]
              extras.push({ kind, rect: { x: x + (width - size.w) / 2, y: top, ...size } })
              top += size.h + CONSOLE_GAP
            }
          }
        }

  const lanes = preset.lanes.map((_, i) => laneBlock(i))
  const half = Math.ceil(lanes.length / 2)
  const row: Block[] = spine ? [...lanes.slice(0, half), spine, ...lanes.slice(half)] : lanes

  const rowWidth = row.reduce((w, b) => w + b.w, 0) + Math.max(0, row.length - 1) * BLOCK_GAP
  const rowHeight = Math.max(0, ...row.map((b) => b.h))
  const hasOrchestrator = preset.extras.some((e) => e.kind === 'orchestrator')
  const orch = PRESET_EXTRA_SIZE.orchestrator
  const totalHeight = rowHeight + (hasOrchestrator ? orch.h + ORCHESTRATOR_GAP : 0)

  const top = center.y - totalHeight / 2
  const rowTop = top + (hasOrchestrator ? orch.h + ORCHESTRATOR_GAP : 0)
  if (hasOrchestrator) {
    extras.unshift({ kind: 'orchestrator', rect: { x: center.x - orch.w / 2, y: top, ...orch } })
  }
  let x = center.x - rowWidth / 2
  for (const block of row) {
    block.place(x, rowTop)
    x += block.w + BLOCK_GAP
  }
  return { consoles, extras }
}

export function placementRects(placement: PresetPlacement): Rect[] {
  return [...placement.consoles.flat(), ...placement.extras.map((e) => e.rect)]
}
