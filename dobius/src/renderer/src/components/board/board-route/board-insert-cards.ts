import { translate } from '@/i18n/i18n'
import { DEFAULT_GOAL_REMINDERS, type BoardSwatch, type NewBoardCard } from '@/store/slices/board'
import { getBoardToolStyle } from '../board-tool-panels/board-tool-style-store'
import { clampRectIntoArea } from '../cards/card-geometry'

const SWATCHES: readonly string[] = ['yellow', 'pink', 'blue', 'green', 'purple', 'accent']
const isBoardSwatch = (fill: string): fill is BoardSwatch => SWATCHES.includes(fill)
import type { BoardPoint } from '../board-canvas/board-viewport'

export type BoardInsertCardKind =
  | 'todo'
  | 'kanban'
  | 'calendar'
  | 'orchestrator'
  | 'text'
  | 'shape'
  | 'screen'
  | 'web'
  | 'memory'
  | 'goal'
  | 'skill'
  | 'branches'

const SIZES: Record<BoardInsertCardKind, { w: number; h: number }> = {
  todo: { w: 280, h: 320 },
  kanban: { w: 720, h: 380 },
  calendar: { w: 420, h: 380 },
  orchestrator: { w: 360, h: 460 },
  text: { w: 240, h: 48 },
  shape: { w: 160, h: 120 },
  screen: { w: 180, h: 140 },
  web: { w: 900, h: 600 },
  memory: { w: 300, h: 180 },
  // Why: tall enough that a new goal card shows all of its default content.
  goal: { w: 340, h: 620 },
  skill: { w: 320, h: 170 },
  branches: { w: 300, h: 360 }
}

export function boardInsertCardSize(kind: BoardInsertCardKind): { w: number; h: number } {
  return SIZES[kind]
}

type Rect = { x: number; y: number; w: number; h: number }

/**
 * The card `boardInsertCard` builds for a canvas click at `world`, kept inside
 * `area` (the visible world minus board chrome) so its title bar stays on screen.
 * The hover ghost and the click both come from here, so they always agree.
 */
export function boardInsertCardAt(
  kind: BoardInsertCardKind,
  world: BoardPoint,
  area: Rect
): NewBoardCard {
  const placed = boardInsertCard(kind, world)
  return { ...placed, ...clampRectIntoArea(placed, area) }
}

/** A new default card of `kind`, centered on `center` (world coords). */
export function boardInsertCard(kind: BoardInsertCardKind, center: BoardPoint): NewBoardCard {
  const { w, h } = SIZES[kind]
  const base = { x: center.x - w / 2, y: center.y - h / 2, w, h }
  switch (kind) {
    case 'todo':
      return {
        ...base,
        kind: 'checklist',
        title: translate('board.insert.todo', 'To-do list'),
        items: []
      }
    case 'kanban':
      return {
        ...base,
        kind: 'kanban',
        title: translate('board.insert.kanban', 'Kanban'),
        columns: [
          { id: crypto.randomUUID(), title: translate('board.kanban.todo', 'To do'), items: [] },
          { id: crypto.randomUUID(), title: translate('board.kanban.doing', 'Doing'), items: [] },
          { id: crypto.randomUUID(), title: translate('board.kanban.done', 'Done'), items: [] }
        ]
      }
    case 'calendar':
      return {
        ...base,
        kind: 'calendar',
        title: translate('board.insert.calendar', 'Calendar'),
        events: []
      }
    case 'orchestrator': {
      const name = translate('board.insert.orchestrator', 'Orchestrator')
      return { ...base, kind: 'orchestrator', title: name, name, wiredCardIds: [] }
    }
    case 'text':
      return {
        ...base,
        kind: 'text',
        title: translate('board.tools.text', 'Text'),
        text: '',
        style: getBoardToolStyle('text').style
      }
    case 'shape': {
      // Current pick in the Shapes panel; "sticky" is a note card, not a shape.
      const { shape, style } = getBoardToolStyle('shape')
      if (shape === 'sticky') {
        return {
          ...base,
          kind: 'note',
          title: translate('board.tools.sticky', 'Sticky note'),
          text: '',
          color: 'yellow'
        }
      }
      return {
        ...base,
        kind: 'shape',
        title: translate('board.tools.shape', 'Shapes'),
        shape,
        fill: isBoardSwatch(style.fill) ? style.fill : 'blue',
        style
      }
    }
    // ponytail: "Diagrams" drops a diamond shape until a real diagram card exists.
    case 'screen':
      return {
        ...base,
        kind: 'shape',
        title: translate('board.tools.screen', 'Diagrams'),
        shape: 'diamond',
        fill: 'purple'
      }
    case 'web':
      return { ...base, kind: 'web', title: translate('board.tools.web', 'Web tile'), url: '' }
    case 'memory':
      return {
        ...base,
        kind: 'memory',
        title: translate('board.studio.title.memory', 'Memory'),
        wiredCardIds: []
      }
    case 'goal':
      return {
        ...base,
        kind: 'goal',
        title: translate('board.insert.goal', 'Goal'),
        goal: '',
        criteria: [],
        dont: [],
        reminders: { ...DEFAULT_GOAL_REMINDERS },
        driftCheck: false,
        wiredCardIds: []
      }
    case 'skill':
      return {
        ...base,
        kind: 'skill',
        title: translate('board.insert.skill', 'Skill'),
        skillName: '',
        args: ''
      }
    case 'branches':
      return {
        ...base,
        kind: 'branches',
        title: translate('board.insert.branches', 'Git branches')
      }
  }
}

/** Below this on-screen drag distance a shape-tool press is a click (default size). */
export const SHAPE_DRAG_THRESHOLD_PX = 4
/** Smallest side (world px) a dragged shape may have. */
export const SHAPE_MIN_SIDE = 24

/**
 * The world rect a shape-tool drag from `start` to `end` describes, normalised
 * for any drag direction; null when the press barely moved (a click), so the
 * caller drops the default-size shape instead.
 */
export function boardDraggedShapeRect(
  start: BoardPoint,
  end: BoardPoint,
  zoom: number
): { x: number; y: number; w: number; h: number } | null {
  const scale = zoom > 0 ? zoom : 1
  const w = Math.abs(end.x - start.x)
  const h = Math.abs(end.y - start.y)
  if (Math.max(w, h) * scale < SHAPE_DRAG_THRESHOLD_PX) {
    return null
  }
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.max(SHAPE_MIN_SIDE, w),
    h: Math.max(SHAPE_MIN_SIDE, h)
  }
}
