// Where a pointer or key event lands, for click-to-focus: which card a title
// click or body double-click focuses, a group's name tab, and the Esc / ⌥←/→ split.
import { BOARD_GROUP_FRAME_PADDING } from '../board-canvas/board-camera-focus'
import type { BoardPoint } from '../board-canvas/board-viewport'
import { boundsOf } from '../cards/card-geometry'

export const TERMINAL_SELECTOR = '[data-board-console], .xterm'
const TEXT_FIELD_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]'

/** Where a key event lands, for the Esc / Shift+Esc and ⌥←/→ split. */
export type BoardKeyTarget = 'terminal' | 'field' | 'overlay' | 'board'

export function boardKeyTarget(target: EventTarget | null): BoardKeyTarget {
  if (!(target instanceof Element)) {
    return 'board'
  }
  // Why: xterm's input is a hidden textarea, so check terminals before fields.
  if (target.closest(TERMINAL_SELECTOR)) {
    return 'terminal'
  }
  if (
    target.closest(TEXT_FIELD_SELECTOR) ||
    (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return 'field'
  }
  if (target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) {
    return 'overlay'
  }
  return 'board'
}

/**
 * Esc leaves focus mode from the board itself; inside a terminal plain Esc
 * belongs to the app running there (vim, Claude Code), so Shift+Esc is the way out.
 */
export function boardEscapeExitsFocus(where: BoardKeyTarget, shiftKey: boolean): boolean {
  if (where === 'overlay') {
    return false
  }
  return where === 'board' || shiftKey
}

/**
 * ⌥←/→ steps through every card; inside a terminal it needs Shift too (⌥← is
 * word-jump in shells). Text fields keep both, since ⌥⇧← selects a word there.
 */
export function boardArrowStep(
  event: { key: string; altKey: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  where: BoardKeyTarget
): 1 | -1 | null {
  if (!event.altKey || event.metaKey || event.ctrlKey) {
    return null
  }
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
    return null
  }
  if (where === 'field' || where === 'overlay') {
    return null
  }
  if (event.shiftKey !== (where === 'terminal')) {
    return null
  }
  return event.key === 'ArrowRight' ? 1 : -1
}

function cardIdOf(cardEl: Element): string | null {
  return (
    cardEl.getAttribute('data-board-card-id') ??
    cardEl
      .querySelector('[data-board-console-card-id]')
      ?.getAttribute('data-board-console-card-id') ??
    null
  )
}

/** Things inside a card that keep their own clicks: never a focus trigger. */
const CARD_OWN_INPUT_SELECTOR =
  '[data-board-card-control], button, a, input, textarea, select, [contenteditable], [role="button"], [role="checkbox"], webview, iframe'

/**
 * The card whose title bar (or a console's zoomed-out glance) holds `target`:
 * a single click there focuses it. Never its body, controls or resize handles.
 */
export function boardFocusClickCardId(target: Element): string | null {
  const cardEl = target.closest('[data-board-card]')
  if (!cardEl || target.closest(CARD_OWN_INPUT_SELECTOR)) {
    return null
  }
  const header = target.closest('[data-board-card-header]')
  const onHeader = header !== null && cardEl.contains(header)
  const onGlance = target.closest('[data-board-console-glance]') !== null
  return onHeader || onGlance ? cardIdOf(cardEl) : null
}

/**
 * Card kinds whose body double-click is free for focus. Text, shapes and
 * notes edit inline, kanban edits items, web tiles are live pages and file
 * cards select words to copy: those focus from the title bar or Enter/F only.
 */
const BODY_DOUBLE_CLICK_FOCUS_KINDS: ReadonlySet<string> = new Set([
  'console',
  'image',
  'calendar',
  'checklist',
  'branches',
  'orchestrator',
  'memory',
  'skill'
])

export function boardBodyDoubleClickFocuses(kind: string | undefined): boolean {
  return kind !== undefined && BODY_DOUBLE_CLICK_FOCUS_KINDS.has(kind)
}

/** The card a body double-click on `target` should focus, or null when the card keeps it. */
export function boardFocusDoubleClickCardId(
  target: Element,
  kindOf: (cardId: string) => string | undefined
): string | null {
  const cardEl = target.closest('[data-board-card]')
  if (!cardEl || target.closest('[data-board-card-header]')) {
    return null
  }
  const cardId = cardIdOf(cardEl)
  const kind = cardId ? kindOf(cardId) : undefined
  if (!cardId || !boardBodyDoubleClickFocuses(kind)) {
    return null
  }
  // Why: xterm's input is a hidden textarea, so consoles only check for their terminal body.
  if (kind === 'console') {
    return target.closest('[data-board-console]') ? cardId : null
  }
  return target.closest(CARD_OWN_INPUT_SELECTOR) ? null : cardId
}

/** World px either side of a group frame's top edge that count as its name tab. */
const GROUP_TAB_REACH = 16

/**
 * The group whose name tab sits at `world` (the tab straddles the frame's top
 * edge, inset from its left). Null when the point is not on one.
 */
export function boardGroupTabAt(
  world: BoardPoint,
  groups: readonly { id: string; cardIds: readonly string[] }[],
  cards: readonly { id: string; x: number; y: number; w: number; h: number }[]
): string | null {
  for (const group of groups) {
    const members = new Set(group.cardIds)
    const frame = boundsOf(
      cards.filter((c) => members.has(c.id)),
      BOARD_GROUP_FRAME_PADDING
    )
    if (
      frame &&
      Math.abs(world.y - frame.y) <= GROUP_TAB_REACH &&
      world.x >= frame.x &&
      world.x <= frame.x + frame.w
    ) {
      return group.id
    }
  }
  return null
}
