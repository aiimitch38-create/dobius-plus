// Why: the world layer overflows the canvas, and `overflow: hidden` only hides
// scrollbars — the browser still scrolls the canvas (and its wrappers) to reveal
// a focused element, e.g. a terminal's hidden textarea at its cursor or a text
// card being edited. That scroll offset is invisible to the viewport model, so
// every card renders shifted up-left of where the camera framed it (the focused
// console landed at the top-left corner, partly off screen). These containers
// must never hold a scroll offset; the viewport transform is the only camera.

/** Board containers that must stay at scroll 0,0. */
export const BOARD_SCROLL_LOCK_SELECTOR =
  '[data-board-scroll-lock], [data-board-canvas], [data-board-console]'

/** Snaps one element back to scroll 0,0. True when it had drifted. */
export function resetBoardScroll(el: Element): boolean {
  if (el.scrollLeft === 0 && el.scrollTop === 0) {
    return false
  }
  el.scrollLeft = 0
  el.scrollTop = 0
  return true
}

/** Resets every locked Board container under `root` (synchronously). */
export function resetAllBoardScroll(root: ParentNode = document): void {
  for (const el of root.querySelectorAll(BOARD_SCROLL_LOCK_SELECTOR)) {
    resetBoardScroll(el)
  }
  if (root instanceof Element && root.matches(BOARD_SCROLL_LOCK_SELECTOR)) {
    resetBoardScroll(root)
  }
}

/**
 * Undoes any browser-initiated scroll of a locked container inside `root`.
 * Scroll events do not bubble, so the listener runs in the capture phase.
 */
export function installBoardScrollLock(root: EventTarget): () => void {
  const onScroll = (event: Event): void => {
    const target = event.target
    if (target instanceof Element && target.matches(BOARD_SCROLL_LOCK_SELECTOR)) {
      resetBoardScroll(target)
    }
  }
  root.addEventListener('scroll', onScroll, true)
  return () => root.removeEventListener('scroll', onScroll, true)
}
