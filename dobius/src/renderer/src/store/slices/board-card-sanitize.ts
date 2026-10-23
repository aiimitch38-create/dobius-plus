// Per-kind field sanitizer for board cards (split from board-state.ts for size).
// Persisted JSON can be hand-edited or old; anything malformed becomes null.
import {
  sanitizeBoardCardStyle,
  type BoardCardStyle
} from '@/components/board/board-tool-panels/board-tool-style'
import type { BoardCard, BoardCardBase, BoardShapeKind, BoardSwatch } from './board-state'

// Why: image cards must reference files, not embed them; a data URL past this
// size would turn every board save into a megabyte rewrite of config.
export const BOARD_IMAGE_SRC_MAX_LENGTH = 64 * 1024

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export const SWATCHES: readonly BoardSwatch[] = [
  'yellow',
  'pink',
  'blue',
  'green',
  'purple',
  'accent'
]
const SHAPES: readonly BoardShapeKind[] = [
  'rect',
  'ellipse',
  'diamond',
  'triangle',
  'line',
  'arrow'
]

// Style is optional (cards from before the tool panels have none) and, when
// present, every field is repaired from defaults.
export const styleField = (raw: Raw): { style?: BoardCardStyle } =>
  raw.style === undefined ? {} : { style: sanitizeBoardCardStyle(raw.style) }

export type Raw = Record<string, unknown>
export const isObj = (v: unknown): v is Raw =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
export const isStr = (v: unknown): v is string => typeof v === 'string'
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr)
export const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  isStr(v) && (list as readonly string[]).includes(v)

export function isPersistableImageSrc(src: string): boolean {
  return src.length <= BOARD_IMAGE_SRC_MAX_LENGTH
}

export function sanitizeKindFields(
  raw: Raw
): DistributiveOmit<BoardCard, keyof BoardCardBase> | null {
  switch (raw.kind) {
    case 'console':
      return isStr(raw.tabId) && isStr(raw.agentKind)
        ? {
            kind: 'console',
            tabId: raw.tabId,
            agentKind: raw.agentKind,
            ...(isStr(raw.role) ? { role: raw.role } : {}),
            ...(raw.yolo === true ? { yolo: true } : {}),
            ...(isStr(raw.accountId) ? { accountId: raw.accountId } : {})
          }
        : null
    case 'web':
      return isStr(raw.url)
        ? { kind: 'web', url: raw.url, ...(isStr(raw.device) ? { device: raw.device } : {}) }
        : null
    case 'note':
      return isStr(raw.text) && oneOf(SWATCHES, raw.color)
        ? { kind: 'note', text: raw.text, color: raw.color }
        : null
    case 'text':
      return isStr(raw.text) ? { kind: 'text', text: raw.text, ...styleField(raw) } : null
    case 'checklist':
      return Array.isArray(raw.items)
        ? {
            kind: 'checklist',
            items: raw.items
              .filter((i): i is Raw => isObj(i) && isStr(i.id) && isStr(i.text))
              .map((i) => ({ id: i.id as string, text: i.text as string, done: i.done === true }))
          }
        : null
    case 'kanban':
      return Array.isArray(raw.columns)
        ? {
            kind: 'kanban',
            columns: raw.columns
              .filter((c): c is Raw => isObj(c) && isStr(c.id) && isStr(c.title))
              .map((c) => ({
                id: c.id as string,
                title: c.title as string,
                items: (Array.isArray(c.items) ? c.items : [])
                  .filter((i): i is Raw => isObj(i) && isStr(i.id) && isStr(i.text))
                  .map((i) => ({ id: i.id as string, text: i.text as string }))
              }))
          }
        : null
    case 'calendar':
      return Array.isArray(raw.events)
        ? {
            kind: 'calendar',
            events: raw.events
              .filter((e): e is Raw => isObj(e) && isStr(e.id) && isStr(e.title) && isStr(e.date))
              .map((e) => ({
                id: e.id as string,
                date: e.date as string,
                title: e.title as string
              }))
          }
        : null
    case 'shape':
      // Why: the Shapes panel's "sticky" is a note card, never a shape.
      if (raw.shape === 'sticky') {
        return {
          kind: 'note',
          text: isStr(raw.text) ? raw.text : '',
          color: oneOf(SWATCHES, raw.fill) ? raw.fill : 'yellow'
        }
      }
      return oneOf(SHAPES, raw.shape)
        ? {
            kind: 'shape',
            shape: raw.shape,
            fill: oneOf(SWATCHES, raw.fill) ? raw.fill : 'accent',
            ...(isStr(raw.label) && raw.label ? { label: raw.label } : {}),
            ...(raw.direction === 'sw' || raw.direction === 'nw' || raw.direction === 'ne'
              ? { direction: raw.direction }
              : {}),
            ...styleField(raw)
          }
        : null
    case 'stroke':
      return Array.isArray(raw.points)
        ? {
            kind: 'stroke',
            points: raw.points.filter(
              (p): p is [number, number] =>
                Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1])
            ),
            ...styleField(raw)
          }
        : null
    case 'image':
      return isStr(raw.src) && isPersistableImageSrc(raw.src)
        ? { kind: 'image', src: raw.src }
        : null
    case 'markdown':
      return isStr(raw.path) ? { kind: 'markdown', path: raw.path } : null
    case 'orchestrator':
      return isStr(raw.name) && isStrArray(raw.wiredCardIds)
        ? {
            kind: 'orchestrator',
            name: raw.name,
            wiredCardIds: raw.wiredCardIds,
            ...(isStr(raw.teamAgent) ? { teamAgent: raw.teamAgent } : {})
          }
        : null
    case 'memory':
      return isStrArray(raw.wiredCardIds)
        ? { kind: 'memory', wiredCardIds: raw.wiredCardIds }
        : null
    case 'skill':
      return isStr(raw.skillName) && isStr(raw.args)
        ? { kind: 'skill', skillName: raw.skillName, args: raw.args }
        : null
    case 'branches':
      return { kind: 'branches' }
    default:
      return null
  }
}
