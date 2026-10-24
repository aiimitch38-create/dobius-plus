import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { getBoard, type BoardTool } from '@/store/slices/board'
import {
  clearBoardFocus,
  exitBoardFocus,
  focusBoardConsole,
  stepBoardFocus,
  useBoardCameraFocus,
  type BoardCameraFocus
} from '../board-canvas/board-camera-focus'
import { CARD_DRAG_THRESHOLD_PX } from '../cards/card-drag-target'
import type { BoardSelection } from './use-board-selection'

const TERMINAL_SELECTOR = '[data-board-console], .xterm'
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

/** ⌥←/→ steps consoles; inside a terminal it needs Shift too (⌥← is word-jump in shells). */
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

function consoleCardIdOf(cardEl: Element): string | null {
  return (
    cardEl
      .querySelector('[data-board-console-card-id]')
      ?.getAttribute('data-board-console-card-id') ?? null
  )
}

/** The console whose title bar (not its body, controls or resize handles) holds `target`. */
function consoleHeaderCardId(target: Element): string | null {
  const cardEl = target.closest('[data-board-card]')
  if (!cardEl || target.closest('[data-board-card-control], button, input')) {
    return null
  }
  const header = cardEl.firstElementChild
  return header && header.contains(target) ? consoleCardIdOf(cardEl) : null
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

/**
 * Click-to-focus wiring: title click, body double-click, Esc / Shift+Esc,
 * ⌥←/→, empty-canvas click back to the overview, and selecting the focused
 * console so its terminal takes the keyboard on arrival.
 */
export function useBoardFocusMode(options: CameraFocusOptions): {
  focus: BoardCameraFocus | null
  /** Enter/F: focus the single selected console. False when none is selected. */
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
  useEffect(() => {
    if (focusedCardId) {
      ref.current.selection.selectOnly([focusedCardId])
    }
  }, [focusedCardId])

  // A focused card that is deleted ends focus mode.
  const focusedCardExists = useAppStore((s) =>
    focusedCardId ? getBoard(s, worktreeId).cards.some((c) => c.id === focusedCardId) : true
  )
  useEffect(() => {
    if (!focusedCardExists) {
      clearBoardFocus()
    }
  }, [focusedCardExists])

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
      if (event.shiftKey || event.metaKey || event.ctrlKey || o.tool !== 'select') {
        return
      }
      const cardId = consoleHeaderCardId(target)
      if (cardId) {
        focusBoardConsole(o.worktreeId, cardId)
      }
    }
    const onDoubleClick = (event: MouseEvent): void => {
      const o = ref.current
      if (!o.worktreeId || o.suspended || !(event.target instanceof Element)) {
        return
      }
      const body = event.target.closest('[data-board-console]')
      const cardEl = body?.closest('[data-board-card]')
      const cardId = cardEl ? consoleCardIdOf(cardEl) : null
      // Why: once focused, a double-click is the terminal's word selection again.
      if (cardId && useBoardCameraFocus.getState().focus?.cardId !== cardId) {
        focusBoardConsole(o.worktreeId, cardId)
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
      const selected = getBoard(useAppStore.getState(), o.worktreeId).cards.find(
        (c) => c.kind === 'console' && o.selection.selectedIds.has(c.id)
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
    if (!o.worktreeId || o.selection.selectedIds.size !== 1) {
      return false
    }
    const card = getBoard(useAppStore.getState(), o.worktreeId).cards.find((c) =>
      o.selection.selectedIds.has(c.id)
    )
    return card?.kind === 'console' ? focusBoardConsole(o.worktreeId, card.id) : false
  }, [])

  const exit = useCallback(() => {
    if (exitBoardFocus()) {
      blurTerminalFocus()
    }
  }, [])

  return { focus, focusSelected, exit }
}
