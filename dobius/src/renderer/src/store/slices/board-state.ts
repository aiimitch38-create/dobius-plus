// Board data model + the sanitizer that guards it on hydration. Kept apart from
// the slice so the slice file stays focused on actions.
import type { BoardCardStyle } from '@/components/board/board-tool-panels/board-tool-style'
import {
  SWATCHES,
  isNum,
  isObj,
  isStr,
  isStrArray,
  oneOf,
  sanitizeKindFields,
  styleField,
  type DistributiveOmit,
  type Raw
} from './board-card-sanitize'

export {
  BOARD_IMAGE_SRC_MAX_LENGTH,
  DEFAULT_GOAL_REMINDERS,
  isPersistableImageSrc
} from './board-card-sanitize'

export type BoardTool =
  | 'select'
  | 'spawn'
  | 'shape'
  | 'screen'
  | 'text'
  | 'pen'
  | 'eraser'
  | 'web'
  | 'image'

export type BoardSwatch = 'yellow' | 'pink' | 'blue' | 'green' | 'purple' | 'accent'
export type BoardLineDirection = 'se' | 'sw' | 'nw' | 'ne'
export type BoardShapeKind = 'rect' | 'ellipse' | 'diamond' | 'triangle' | 'line' | 'arrow'

export type BoardChecklistItem = { id: string; text: string; done: boolean }
export type BoardKanbanColumn = { id: string; title: string; items: { id: string; text: string }[] }
// Why: date is a local YYYY-MM-DD key so events don't shift across time zones.
export type BoardCalendarEvent = { id: string; date: string; title: string }
// Goal card: the main goal its wired agents are reminded of (board-goal/*).
export type BoardGoalCriterion = { id: string; text: string; done: boolean; evidence?: string }
export type BoardGoalDont = { id: string; text: string }
/** everyTurns: remind after this many completed turns; 0 = off. */
export type BoardGoalReminders = {
  afterCompaction: boolean
  everyTurns: number
  onNewTask: boolean
}

export type BoardWebSession = 'incognito' | 'shared'

export type BoardCardBase = {
  id: string
  x: number
  y: number
  w: number
  h: number
  z: number
  title: string
}

export type BoardCard = BoardCardBase &
  (
    | {
        kind: 'console'
        tabId: string
        agentKind: string
        /** Addressable role (review, tests, frontend…); planner targets can name it. */
        role?: string | null
        /** Launched with permission prompts skipped; shown as a badge. */
        yolo?: boolean
        /** Managed account this console is pinned to (Claude/Codex); unset = Settings default. */
        accountId?: string
      }
    // device: simulated viewport id (board-web/web-tile-devices); unset = fill the tile.
    // session: 'shared' browses with the signed-in browser profile; unset = private (incognito).
    // popupOf: id of the tile whose page opened this one as a popup (caps siblings per source).
    // driverCardId: console card wired to drive this tile (board-browser-link/*); pruned with the console.
    | {
        kind: 'web'
        url: string
        device?: string
        session?: BoardWebSession
        popupOf?: string
        driverCardId?: string
      }
    | { kind: 'note'; text: string; color: BoardSwatch }
    | { kind: 'text'; text: string; style?: BoardCardStyle }
    | { kind: 'checklist'; items: BoardChecklistItem[] }
    | { kind: 'kanban'; columns: BoardKanbanColumn[] }
    | { kind: 'calendar'; events: BoardCalendarEvent[] }
    // label: text drawn inside the shape (diagram nodes); unset = empty shape.
    | {
        kind: 'shape'
        shape: BoardShapeKind
        fill: BoardSwatch
        style?: BoardCardStyle
        label?: string
        /** Lines/arrows: which corner the line points to; unset = 'se' (top-left to bottom-right). */
        direction?: BoardLineDirection
      }
    // Why: stroke points are relative to the card origin so moving the card moves the ink.
    | { kind: 'stroke'; points: [number, number][]; style?: BoardCardStyle }
    | { kind: 'image'; src: string }
    | { kind: 'markdown'; path: string }
    // teamAgent: agent the card's + / grow-team spawns; unset = the board's default.
    | { kind: 'orchestrator'; name: string; wiredCardIds: string[]; teamAgent?: string }
    // Why: wired to console cards and/or group ids; Push sends the repo's active memory to them.
    | { kind: 'memory'; wiredCardIds: string[] }
    // Why: wired to consoles, orchestrators and/or groups; reminders reach every console behind them.
    | {
        kind: 'goal'
        goal: string
        criteria: BoardGoalCriterion[]
        dont: BoardGoalDont[]
        reminders: BoardGoalReminders
        /** Ask the read-only goal judge whether each finished report serves the goal. */
        driftCheck: boolean
        wiredCardIds: string[]
      }
    | { kind: 'skill'; skillName: string; args: string }
    | { kind: 'branches' }
  )

export type BoardCardKind = BoardCard['kind']

/** The web tile without its console driver link (the console was removed or is not on the board). */
export function withoutDriver(card: BoardCardOf<'web'>): BoardCardOf<'web'> {
  const { driverCardId: _dropped, ...rest } = card
  return rest
}
export type BoardCardOf<K extends BoardCardKind> = Extract<BoardCard, { kind: K }>

export type NewBoardCard = DistributiveOmit<BoardCard, 'id' | 'z'> & { id?: string }
export type BoardCardPatch = Partial<DistributiveOmit<BoardCard, 'id' | 'kind'>>

export type BoardGroup = { id: string; name: string; color: BoardSwatch; cardIds: string[] }
export type BoardViewport = { x: number; y: number; zoom: number }

/** Arrow from one card to another; it follows both cards when they move. */
export type BoardConnector = {
  id: string
  fromCardId: string
  toCardId: string
  label?: string
  style?: BoardCardStyle
}

export type BoardState = {
  cards: BoardCard[]
  groups: BoardGroup[]
  /** Optional so boards saved before connectors (and test fixtures) stay valid. */
  connectors?: BoardConnector[]
  viewport: BoardViewport
  tool: BoardTool
}

export const BOARD_MIN_ZOOM = 0.1
// Why: one source of truth; the canvas imports these instead of keeping its own.
export const BOARD_MAX_ZOOM = 3
export const EMPTY_BOARD: BoardState = Object.freeze({
  cards: [],
  groups: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  tool: 'select'
}) as BoardState

const TOOLS: readonly BoardTool[] = [
  'select',
  'spawn',
  'shape',
  'screen',
  'text',
  'pen',
  'eraser',
  'web',
  'image'
]
export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, zoom)) : 1
}

function sanitizeCard(raw: unknown): BoardCard | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.title)) {
    return null
  }
  const { x, y, w, h, z } = raw
  if (!isNum(x) || !isNum(y) || !isNum(w) || !isNum(h) || !isNum(z) || w <= 0 || h <= 0) {
    return null
  }
  const fields = sanitizeKindFields(raw)
  return fields ? ({ id: raw.id, x, y, w, h, z, title: raw.title, ...fields } as BoardCard) : null
}

function sanitizeBoard(raw: unknown): BoardState | null {
  if (!isObj(raw) || !Array.isArray(raw.cards)) {
    return null
  }
  const cards = raw.cards.map(sanitizeCard).filter((c): c is BoardCard => c !== null)
  const cardIds = new Set(cards.map((c) => c.id))
  const groups = (Array.isArray(raw.groups) ? raw.groups : [])
    .filter((g): g is Raw => isObj(g) && isStr(g.id) && isStr(g.name) && isStrArray(g.cardIds))
    .map((g) => ({
      id: g.id as string,
      name: g.name as string,
      color: oneOf(SWATCHES, g.color) ? g.color : 'accent',
      cardIds: (g.cardIds as string[]).filter((id) => cardIds.has(id))
    }))
  const connectors = (Array.isArray(raw.connectors) ? raw.connectors : [])
    .filter(
      (c): c is Raw =>
        isObj(c) &&
        isStr(c.id) &&
        isStr(c.fromCardId) &&
        isStr(c.toCardId) &&
        c.fromCardId !== c.toCardId &&
        cardIds.has(c.fromCardId) &&
        cardIds.has(c.toCardId)
    )
    .map((c) => ({
      id: c.id as string,
      fromCardId: c.fromCardId as string,
      toCardId: c.toCardId as string,
      ...(isStr(c.label) ? { label: c.label } : {}),
      ...styleField(c)
    }))
  const vp = isObj(raw.viewport) ? raw.viewport : {}
  return {
    cards,
    groups,
    ...(connectors.length > 0 ? { connectors } : {}),
    viewport: {
      x: isNum(vp.x) ? vp.x : 0,
      y: isNum(vp.y) ? vp.y : 0,
      zoom: isNum(vp.zoom) ? clampZoom(vp.zoom) : 1
    },
    tool: oneOf(TOOLS, raw.tool) ? raw.tool : 'select'
  }
}

// Why: persisted JSON can be hand-edited or come from an older build; drop
// anything malformed instead of letting it crash the canvas render.
export function sanitizeBoardsByWorktree(raw: unknown): Record<string, BoardState> {
  if (!isObj(raw)) {
    return {}
  }
  const out: Record<string, BoardState> = {}
  for (const [worktreeId, value] of Object.entries(raw)) {
    const board = sanitizeBoard(value)
    if (board) {
      out[worktreeId] = board
    }
  }
  return out
}
