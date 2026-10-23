import { translate } from '@/i18n/i18n'
import type { BoardSwatch, NewBoardCard } from '@/store/slices/board'
import { getBoardToolStyle } from '../board-tool-panels/board-tool-style-store'

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
  skill: { w: 320, h: 170 },
  branches: { w: 300, h: 360 }
}

export function boardInsertCardSize(kind: BoardInsertCardKind): { w: number; h: number } {
  return SIZES[kind]
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
