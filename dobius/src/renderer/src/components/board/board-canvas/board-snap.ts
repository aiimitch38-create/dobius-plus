export type SnapBox = { x: number; y: number; w: number; h: number }
/** A guide line in world space: vertical (axis 'x' at x=`at`) or horizontal. */
export type SnapGuide = { axis: 'x' | 'y'; at: number; from: number; to: number }

type Axis = 'x' | 'y'

function stops(box: SnapBox, axis: Axis): number[] {
  return axis === 'x'
    ? [box.x, box.x + box.w / 2, box.x + box.w]
    : [box.y, box.y + box.h / 2, box.y + box.h]
}

function snapAxis(
  moving: SnapBox,
  others: readonly SnapBox[],
  axis: Axis,
  threshold: number
): { delta: number; guide: SnapGuide | null } {
  let best: { delta: number; at: number; other: SnapBox } | null = null
  for (const other of others) {
    for (const target of stops(other, axis)) {
      for (const edge of stops(moving, axis)) {
        const delta = target - edge
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, at: target, other }
        }
      }
    }
  }
  if (!best) {
    return { delta: 0, guide: null }
  }
  const span =
    axis === 'x'
      ? [moving.y, moving.y + moving.h, best.other.y, best.other.y + best.other.h]
      : [moving.x, moving.x + moving.w, best.other.x, best.other.x + best.other.w]
  return {
    delta: best.delta,
    guide: { axis, at: best.at, from: Math.min(...span), to: Math.max(...span) }
  }
}

/**
 * Snaps a dragged box's edges/centers to other cards' edges/centers when within
 * `threshold` world units, per axis independently. Returns the correction to
 * apply and the guide lines to draw.
 */
export function snapBoardBox(
  moving: SnapBox,
  others: readonly SnapBox[],
  threshold: number
): { dx: number; dy: number; guides: SnapGuide[] } {
  const x = snapAxis(moving, others, 'x', threshold)
  const y = snapAxis(moving, others, 'y', threshold)
  return {
    dx: x.delta,
    dy: y.delta,
    guides: [x.guide, y.guide].filter((g): g is SnapGuide => g !== null)
  }
}

export function boundsOfBoxes(boxes: readonly SnapBox[]): SnapBox | null {
  if (boxes.length === 0) {
    return null
  }
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y
  }
}
