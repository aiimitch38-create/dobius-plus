// Focus mode: the camera flown onto one console, with the exact viewport to
// return to. Session-only; every entry point (click, Enter/F, ⌥←/→, N, the
// needs-you pill, Mission Map Focus) goes through these functions.
import { create } from 'zustand'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { animateBoardViewport, boardCameraFit, boardFocusViewport } from './board-camera'
import { boardReadingOrder, boardStepId } from './board-console-order'
import { resetAllBoardScroll } from './board-scroll-lock'
import type { BoardSize, BoardViewport } from './board-viewport'

export type BoardCameraFocus = {
  worktreeId: string
  cardId: string
  /** The viewport before focus mode began; Esc/Overview returns here exactly. */
  previous: BoardViewport
  /** Bumped when the camera lands, so the card flashes its ring once per arrival. */
  arrivedAt: number
}

export const useBoardCameraFocus = create<{ focus: BoardCameraFocus | null }>(() => ({
  focus: null
}))

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

/** Flies to one console and enters focus mode. False when the card is not on this board. */
export function focusBoardConsole(worktreeId: string, cardId: string): boolean {
  const state = useAppStore.getState()
  const board = getBoard(state, worktreeId)
  const card = board.cards.find((c) => c.id === cardId)
  if (!card) {
    return false
  }
  const current = useBoardCameraFocus.getState().focus
  const previous = current?.worktreeId === worktreeId ? current.previous : board.viewport
  state.bringToFront(worktreeId, [cardId])
  useBoardCameraFocus.setState({ focus: { worktreeId, cardId, previous, arrivedAt: 0 } })
  const target = boardFocusViewport(
    { x: card.x, y: card.y, width: card.w, height: card.h },
    screenSize(),
    state.settings?.terminalFontSize ?? 14
  )
  flyTo(worktreeId, target, () => {
    const focus = useBoardCameraFocus.getState().focus
    if (focus?.cardId === cardId) {
      useBoardCameraFocus.setState({ focus: { ...focus, arrivedAt: Date.now() } })
    }
  })
  return true
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

/** ⌥←/→: the previous/next console in reading order, from the focused or selected one. */
export function stepBoardFocus(
  worktreeId: string,
  step: 1 | -1,
  fromCardId: string | null
): boolean {
  const consoles = getBoard(useAppStore.getState(), worktreeId).cards.filter(
    (c) => c.kind === 'console'
  )
  const ordered = boardReadingOrder(consoles).map((c) => c.id)
  const focus = useBoardCameraFocus.getState().focus
  const current = focus?.worktreeId === worktreeId ? focus.cardId : fromCardId
  const next = boardStepId(ordered, current, step)
  return next ? focusBoardConsole(worktreeId, next) : false
}

/**
 * Frames these cards (Mission Map Focus). One console enters focus mode; a
 * group is fitted inside the safe area at up to 100%. False when none exist.
 */
export function frameBoardCards(worktreeId: string, cardIds: readonly string[]): boolean {
  const state = useAppStore.getState()
  const ids = new Set(cardIds)
  const cards = getBoard(state, worktreeId).cards.filter((c) => ids.has(c.id))
  if (cards.length === 0) {
    return false
  }
  if (cards.length === 1 && cards[0].kind === 'console') {
    return focusBoardConsole(worktreeId, cards[0].id)
  }
  state.bringToFront(
    worktreeId,
    cards.map((c) => c.id)
  )
  flyTo(
    worktreeId,
    boardCameraFit(
      cards.map((c) => ({ x: c.x, y: c.y, width: c.w, height: c.h })),
      screenSize(),
      { padding: 48, maxZoom: 1 }
    )
  )
  return true
}
