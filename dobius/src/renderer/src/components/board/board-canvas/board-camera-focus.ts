// Focus mode: the camera flown onto one card (any kind) or one group, with the
// exact viewport to return to. Session-only; every entry point (click, Enter/F,
// ⌥←/→, N, the needs-you pill, Mission Map Focus) goes through these functions.
import { useAppStore } from '@/store'
import { getBoard, type BoardCard } from '@/store/slices/board'
import { boundsOf } from '../cards/card-geometry'
import {
  animateBoardViewport,
  boardFocusCardViewport,
  boardFocusGroupViewport
} from './board-camera'
import { boardFocusStepOrder, boardStepId } from './board-console-order'
import { resetAllBoardScroll } from './board-scroll-lock'
import { useBoardCameraFocus, type BoardCameraFocus } from './board-focus-state'
import type { BoardSize, BoardViewport } from './board-viewport'

export { useBoardCameraFocus, type BoardCameraFocus }

/** Must match GroupFrame's padding so a focused group fits its visible frame. */
export const BOARD_GROUP_FRAME_PADDING = 24

function screenSize(): BoardSize {
  // The Board canvas is `fixed inset-0`, so its size is normally the window's;
  // measure the canvas itself when it is mounted so the two can never disagree.
  const canvas = document.querySelector('[data-board-canvas]')
  if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
    return { width: canvas.clientWidth, height: canvas.clientHeight }
  }
  return { width: window.innerWidth, height: window.innerHeight }
}

function flyTo(worktreeId: string, target: BoardViewport, onDone?: () => void): void {
  // Why: a scroll offset on the canvas shifts what is rendered away from the
  // viewport model, so the camera would frame a card that shows off-centre.
  resetAllBoardScroll()
  const from = getBoard(useAppStore.getState(), worktreeId).viewport
  animateBoardViewport(from, target, (v) => useAppStore.getState().setViewport(worktreeId, v), {
    size: screenSize(),
    onDone: () => {
      // The focused terminal takes the keyboard mid-flight; undo any reveal scroll it caused.
      resetAllBoardScroll()
      onDone?.()
    }
  })
}

/** Enters (or retargets) focus mode on these cards and flies the camera there. */
function enterFocus(
  worktreeId: string,
  target: { cardId: string | null; cards: readonly BoardCard[]; groupId: string | null },
  viewport: BoardViewport
): void {
  const state = useAppStore.getState()
  const current = useBoardCameraFocus.getState().focus
  const previous =
    current?.worktreeId === worktreeId ? current.previous : getBoard(state, worktreeId).viewport
  const cardIds = target.cards.map((c) => c.id)
  state.bringToFront(worktreeId, cardIds)
  const focus: BoardCameraFocus = {
    worktreeId,
    cardId: target.cardId,
    cardIds,
    groupId: target.groupId,
    previous,
    arrivedAt: 0
  }
  useBoardCameraFocus.setState({ focus })
  flyTo(worktreeId, viewport, () => {
    const now = useBoardCameraFocus.getState().focus
    if (now && now.cardId === focus.cardId && now.groupId === focus.groupId) {
      useBoardCameraFocus.setState({ focus: { ...now, arrivedAt: Date.now() } })
    }
  })
}

/** The viewport focus mode frames this card with; null when it is not on this board. */
export function boardCardFocusViewport(worktreeId: string, cardId: string): BoardViewport | null {
  const state = useAppStore.getState()
  const card = getBoard(state, worktreeId).cards.find((c) => c.id === cardId)
  if (!card) {
    return null
  }
  return boardFocusCardViewport(
    card.kind,
    { x: card.x, y: card.y, width: card.w, height: card.h },
    screenSize(),
    state.settings?.terminalFontSize ?? 14
  )
}

/** Flies to one card of any kind and enters focus mode. False when it is not on this board. */
export function focusBoardCard(worktreeId: string, cardId: string): boolean {
  const card = getBoard(useAppStore.getState(), worktreeId).cards.find((c) => c.id === cardId)
  const target = card ? boardCardFocusViewport(worktreeId, cardId) : null
  if (!card || !target) {
    return false
  }
  enterFocus(worktreeId, { cardId, cards: [card], groupId: null }, target)
  return true
}

/** The console-era name; every card kind focuses the same way now. */
export const focusBoardConsole = focusBoardCard

/** Flies to several cards (fit at up to 100%) in focus mode; a group fits its frame. */
function focusBoardCardSet(
  worktreeId: string,
  cards: readonly BoardCard[],
  groupId: string | null
): boolean {
  const frame = boundsOf(cards, groupId ? BOARD_GROUP_FRAME_PADDING : 0)
  if (!frame) {
    return false
  }
  const target = boardFocusGroupViewport(
    [{ x: frame.x, y: frame.y, width: frame.w, height: frame.h }],
    screenSize()
  )
  enterFocus(worktreeId, { cardId: null, cards, groupId }, target)
  return true
}

/** Flies to a group so its whole frame fits, in focus mode. False when it has no cards. */
export function focusBoardGroup(worktreeId: string, groupId: string): boolean {
  const board = getBoard(useAppStore.getState(), worktreeId)
  const group = board.groups.find((g) => g.id === groupId)
  if (!group) {
    return false
  }
  const members = new Set(group.cardIds)
  return focusBoardCardSet(
    worktreeId,
    board.cards.filter((c) => members.has(c.id)),
    groupId
  )
}

/** Leaves focus mode, flying back to the viewport it started from. False when not focused. */
export function exitBoardFocus(): boolean {
  const focus = useBoardCameraFocus.getState().focus
  if (!focus) {
    return false
  }
  useBoardCameraFocus.setState({ focus: null })
  flyTo(focus.worktreeId, focus.previous)
  return true
}

/** Drops focus mode without moving the camera (card deleted, board switched). */
export function clearBoardFocus(): void {
  if (useBoardCameraFocus.getState().focus) {
    useBoardCameraFocus.setState({ focus: null })
  }
}

/** ⌥←/→: the previous/next card in reading order, from the focused or selected one. */
export function stepBoardFocus(
  worktreeId: string,
  step: 1 | -1,
  fromCardId: string | null
): boolean {
  const cards = getBoard(useAppStore.getState(), worktreeId).cards
  const ordered = boardFocusStepOrder(cards).map((c) => c.id)
  const focus = useBoardCameraFocus.getState().focus
  const current = (focus?.worktreeId === worktreeId ? focus.cardId : null) ?? fromCardId
  const next = boardStepId(ordered, current, step)
  return next ? focusBoardCard(worktreeId, next) : false
}

/**
 * Focuses these cards (Mission Map Focus, Enter/F on a selected group): one
 * card frames like a click on it; a whole group fits its frame; any other set
 * fits together. False when none exist.
 */
export function frameBoardCards(worktreeId: string, cardIds: readonly string[]): boolean {
  const board = getBoard(useAppStore.getState(), worktreeId)
  const ids = new Set(cardIds)
  const cards = board.cards.filter((c) => ids.has(c.id))
  if (cards.length === 0) {
    return false
  }
  if (cards.length === 1) {
    return focusBoardCard(worktreeId, cards[0].id)
  }
  const group = board.groups.find(
    (g) => g.cardIds.length === cards.length && g.cardIds.every((id) => ids.has(id))
  )
  return focusBoardCardSet(worktreeId, cards, group?.id ?? null)
}
