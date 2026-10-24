export const BOARD_CARD_CONTROL_SELECTOR = '[data-board-card-control]'

/**
 * Whether a primary-button pointerdown on a card drag handle should start a drag.
 * Why: React bubbles synthetic events through portals by component tree, so a
 * click inside a portal'd dropdown (card "⋯" menu, title-accessory menus)
 * reaches the header's handler even though the DOM target is outside it.
 * Capturing the pointer there steals the click from the menu item.
 */
export function shouldStartCardDrag(
  button: number,
  target: Element | null,
  handle: Pick<Node, 'contains'>
): boolean {
  if (button !== 0 || !target || !handle.contains(target)) {
    return false
  }
  return !target.closest(BOARD_CARD_CONTROL_SELECTOR)
}

// Screen pixels the pointer must travel before a press becomes a card drag.
export const CARD_DRAG_THRESHOLD_PX = 3

/**
 * Why: capturing the pointer on press retargets click/dblclick to the capturing
 * element, so a double-click on a title or a shape never reached the element that
 * handles it. Capture starts only once the press has really moved.
 */
export function passedCardDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= CARD_DRAG_THRESHOLD_PX
}
