// Where a group's name tab sits. It normally straddles the frame's top edge;
// when that edge is under the board's top chrome (top bar, focus pill) the tab
// slides down inside the frame so it stays clickable.

/** Tab height in world px (12px label + padding). */
export const GROUP_TAB_HEIGHT = 28

/**
 * World-px offset of the tab's center below the frame's top edge: 0 normally,
 * more when the edge sits under `safeTopPx` of screen chrome. Never leaves the frame.
 */
export function groupTabOffset(input: {
  frameTop: number
  frameHeight: number
  zoom: number
  viewportY: number
  safeTopPx: number
}): number {
  const zoom = input.zoom > 0 ? input.zoom : 1
  const tabTopScreen = (input.frameTop - GROUP_TAB_HEIGHT / 2) * zoom + input.viewportY
  if (tabTopScreen >= input.safeTopPx) {
    return 0
  }
  const wanted = (input.safeTopPx - tabTopScreen) / zoom
  return Math.max(0, Math.min(wanted, input.frameHeight - GROUP_TAB_HEIGHT / 2))
}

/**
 * Stacking order for the name tab. Why above the members: once the tab slides
 * inside the frame it overlaps member cards, and a console's xterm would take
 * its clicks. The frame itself stays at z 0 so it never blocks a card.
 */
export function groupTabZ(memberZs: readonly number[]): number {
  return memberZs.reduce((top, z) => Math.max(top, Number.isFinite(z) ? z : 0), 0) + 1
}
