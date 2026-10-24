import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import {
  CLEAR_TERMINAL_SELECTION_EVENT,
  type ClearTerminalSelectionDetail
} from '@/constants/terminal'
import { getBoard, type BoardTool } from '@/store/slices/board'
import {
  clearBoardFocus,
  exitBoardFocus,
  focusBoardCard,
  focusBoardGroup,
  frameBoardCards,
  stepBoardFocus,
  useBoardCameraFocus,
  type BoardCameraFocus
} from '../board-canvas/board-camera-focus'
import { screenToWorld, type BoardPoint } from '../board-canvas/board-viewport'
import { CARD_DRAG_THRESHOLD_PX } from '../cards/card-drag-target'
import {
  boardArrowStep,
  boardEscapeExitsFocus,
  boardFocusClickCardId,
  boardFocusDoubleClickCardId,
  boardGroupTabAt,
  boardKeyTarget,
  TERMINAL_SELECTOR
} from './board-focus-targets'
import type { BoardSelection } from './use-board-selection'

/**
 * Drops the word selection a double-click left behind: xterm selects on the
 * second mousedown, before the dblclick that focus mode consumes, and the
 * band would otherwise stay stuck on the terminal.
 */
export function clearConsoleTextSelection(tabId: string | null): void {
  window.getSelection()?.removeAllRanges()
  if (tabId) {
    window.dispatchEvent(
      new CustomEvent<ClearTerminalSelectionDetail>(CLEAR_TERMINAL_SELECTION_EVENT, {
        detail: { tabId }
      })
    )
  }
}

function blurTerminalFocus(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement && active.closest(TERMINAL_SELECTOR)) {
    active.blur()
  }
}

type CameraFocusOptions = {
  worktreeId: string | null
  tool: BoardTool
  selection: BoardSelection
  /** True while a picker or studio owns Esc and the pointer. */
  suspended: boolean
}

/** World point under a client position, through the canvas the board is drawn in. */
function clientToWorld(worktreeId: string, clientX: number, clientY: number): BoardPoint {
  const rect = document.querySelector('[data-board-canvas]')?.getBoundingClientRect()
  const viewport = getBoard(useAppStore.getState(), worktreeId).viewport
  return screenToWorld({ x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }, viewport)
}

/**
 * Click-to-focus wiring for every card kind and group: title click, body
 * double-click (where the card has no double-click of its own), group name
 * tab click, Esc / Shift+Esc, ⌥←/→, empty-canvas click back to the overview,
 * and selecting the focused card on arrival (a console's terminal takes the keyboard).
 */
export function useBoardFocusMode(options: CameraFocusOptions): {
  focus: BoardCameraFocus | null
  /** Enter/F: focus the selected card, or the selected group. False when neither. */
  focusSelected: () => boolean
  exit: () => void
} {
  const { worktreeId } = options
  const ref = useRef(options)
  ref.current = options
  const focus = useBoardCameraFocus((s) =>
    s.focus && s.focus.worktreeId === worktreeId ? s.focus : null
  )

  // Leaving the board or switching workspace drops focus mode in place.
  useEffect(() => () => clearBoardFocus(), [worktreeId])

  const focusedCardId = focus?.cardId ?? null
  const focusedGroupId = focus?.groupId ?? null
  useEffect(() => {
    if (!focusedCardId && !focusedGroupId) {
      return
    }
    const o = ref.current
    const kind = focusedCardId
      ? getBoard(useAppStore.getState(), o.worktreeId).cards.find((c) => c.id === focusedCardId)
          ?.kind
      : undefined
    // Why: only a console has an input worth handing the keyboard to; anything
    // else must not leave keys going to a terminal that is now dimmed.
    if (kind !== 'console') {
      blurTerminalFocus()
    }
    if (focusedCardId) {
      o.selection.selectOnly([focusedCardId])
    }
  }, [focusedCardId, focusedGroupId])

  // A focused card (or group) that is deleted ends focus mode.
  const focusTargetExists = useAppStore((s) => {
    if (!focus) {
      return true
    }
    const board = getBoard(s, worktreeId)
    return (
      board.cards.some((c) => focus.cardIds.includes(c.id)) &&
      (!focus.groupId || board.groups.some((g) => g.id === focus.groupId))
    )
  })
  useEffect(() => {
    if (!focusTargetExists) {
      clearBoardFocus()
    }
  }, [focusTargetExists])

  useEffect(() => {
    let down: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent): void => {
      down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null
    }
    // Why: same threshold as the card drag, so a press is either a drag or a focus click, never both.
    const wasClick = (event: MouseEvent): boolean =>
      down !== null &&
      Math.hypot(event.clientX - down.x, event.clientY - down.y) < CARD_DRAG_THRESHOLD_PX
    const onClick = (event: MouseEvent): void => {
      const o = ref.current
      if (!o.worktreeId || o.suspended || event.button !== 0 || !wasClick(event)) {
        return
      }
      if (!(event.target instanceof Element)) {
        return
      }
      const target = event.target
      if (target.matches('[data-board-canvas], [data-board-world]')) {
        if (o.tool === 'select' && exitBoardFocus()) {
          blurTerminalFocus()
        }
        return
      }
      // Why: the second click of a double-click on a title is the rename gesture.
      if (event.detail > 1) {
        return
      }
      if (event.shiftKey || event.metaKey || event.ctrlKey || o.tool !== 'select') {
        return
      }
      const cardId = boardFocusClickCardId(target)
      if (cardId) {
        focusBoardCard(o.worktreeId, cardId)
        return
      }
      // Why: the tab can slide down inside its frame (top chrome), so the tab
      // element itself wins over the frame-edge hit test.
      const tabGroupId = target.closest('button')
        ? null
        : target.closest('[data-board-group-tab]')?.getAttribute('data-board-group-tab')
      if (tabGroupId) {
        focusBoardGroup(o.worktreeId, tabGroupId)
        return
      }
      // A group's name tab lives in the world layer, outside every card.
      if (!target.closest('[data-board-card], button') && target.closest('[data-board-world]')) {
        const board = getBoard(useAppStore.getState(), o.worktreeId)
        const groupId = boardGroupTabAt(
          clientToWorld(o.worktreeId, event.clientX, event.clientY),
          board.groups,
          board.cards
        )
        if (groupId) {
          focusBoardGroup(o.worktreeId, groupId)
        }
      }
    }
    const onDoubleClick = (event: MouseEvent): void => {
      const o = ref.current
      if (!o.worktreeId || o.suspended || o.tool !== 'select') {
        return
      }
      if (!(event.target instanceof Element)) {
        return
      }
      const cards = getBoard(useAppStore.getState(), o.worktreeId).cards
      const cardId = boardFocusDoubleClickCardId(
        event.target,
        (id) => cards.find((c) => c.id === id)?.kind
      )
      // Why: once focused, a double-click is the card's own again (terminal word selection).
      if (!cardId || useBoardCameraFocus.getState().focus?.cardId === cardId) {
        return
      }
      if (focusBoardCard(o.worktreeId, cardId)) {
        const card = cards.find((c) => c.id === cardId)
        clearConsoleTextSelection(card?.kind === 'console' ? card.tabId : null)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const o = ref.current
      if (!o.worktreeId || o.suspended || event.repeat) {
        return
      }
      const where = boardKeyTarget(event.target)
      if (event.key === 'Escape') {
        if (
          !useBoardCameraFocus.getState().focus ||
          !boardEscapeExitsFocus(where, event.shiftKey)
        ) {
          return
        }
        // Capture phase + stop so Shift+Esc never reaches the terminal app.
        event.preventDefault()
        event.stopPropagation()
        exitBoardFocus()
        blurTerminalFocus()
        return
      }
      const step = boardArrowStep(event, where)
      if (step === null) {
        return
      }
      const selected = getBoard(useAppStore.getState(), o.worktreeId).cards.find((c) =>
        o.selection.selectedIds.has(c.id)
      )
      if (stepBoardFocus(o.worktreeId, step, selected?.id ?? null)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('click', onClick, true)
    window.addEventListener('dblclick', onDoubleClick, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('dblclick', onDoubleClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  const focusSelected = useCallback((): boolean => {
    const o = ref.current
    if (!o.worktreeId || o.selection.selectedIds.size === 0) {
      return false
    }
    const board = getBoard(useAppStore.getState(), o.worktreeId)
    const ids = o.selection.selectedIds
    if (ids.size === 1) {
      const [id] = ids
      return focusBoardCard(o.worktreeId, id)
    }
    // Several selected: only a whole group is a focus target (its frame fits).
    const group = board.groups.find(
      (g) => g.cardIds.length === ids.size && g.cardIds.every((id) => ids.has(id))
    )
    return group ? frameBoardCards(o.worktreeId, group.cardIds) : false
  }, [])

  const exit = useCallback(() => {
    if (exitBoardFocus()) {
      blurTerminalFocus()
    }
  }, [])

  return { focus, focusSelected, exit }
}
