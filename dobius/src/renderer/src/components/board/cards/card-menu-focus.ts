/**
 * Whether a closing menu should skip returning focus to its trigger.
 * Why: Radix restores focus after the exit animation, which is after a menu
 * action (Reply to → command bar) has already moved focus somewhere on
 * purpose; restoring would yank it back to the "⋯" button.
 */
export function focusMovedOutOfMenu(
  active: Element | null,
  body: Element | null,
  menuContent: Pick<Element, 'contains'> | null
): boolean {
  if (!active || active === body) {
    return false
  }
  return !menuContent?.contains(active as Node)
}
