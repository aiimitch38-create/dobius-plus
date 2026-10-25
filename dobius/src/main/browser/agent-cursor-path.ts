// Agent cursor travel: a cubic-bezier curve with a Fitts-style duration so the
// overlay cursor and the CDP mouseMoved events share one natural-looking path
// (docs/board/research/AGENT-CURSORS-RESEARCH.md §6.2).

export type CursorPoint = { x: number; y: number }
export type CursorPathStep = CursorPoint & { /** ms offset from the start of travel. */ at: number }

export const CURSOR_TRAVEL_MIN_MS = 100
export const CURSOR_TRAVEL_MAX_MS = 300
export const CURSOR_STEP_MS = 16

export function cursorTravelDurationMs(distancePx: number): number {
  const raw = 80 + 0.4 * distancePx
  return Math.min(CURSOR_TRAVEL_MAX_MS, Math.max(CURSOR_TRAVEL_MIN_MS, raw))
}

function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5)
}

// Why: a deterministic pseudo-random keeps curves varied between moves while
// tests stay reproducible (no Math.random in the hot path).
function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Cubic-bezier path from `from` to `to`, sampled every CURSOR_STEP_MS, eased
 * out so the pointer decelerates onto the target. Overshoot is disabled for
 * small targets (the control points stay between the endpoints).
 */
export function cursorPath(
  from: CursorPoint,
  to: CursorPoint,
  options: { targetSizePx?: number; seed?: number } = {}
): CursorPathStep[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy)
  if (distance < 0.5) {
    return [{ x: round(to.x), y: round(to.y), at: 0 }]
  }

  const duration = cursorTravelDurationMs(distance)
  const steps = Math.max(2, Math.ceil(duration / CURSOR_STEP_MS))
  const seed = options.seed ?? Math.floor(from.x * 7 + from.y * 13 + to.x * 17 + to.y * 19)
  const allowOvershoot = (options.targetSizePx ?? 0) >= 24

  // Why: bow the curve sideways (perpendicular to travel) by up to ~20% of the
  // distance; humans never move a mouse in a perfectly straight line.
  const bow = (jitter(seed) - 0.5) * 0.4 * distance
  const px = -dy / distance
  const py = dx / distance
  const c1 = { x: from.x + dx * 0.3 + px * bow, y: from.y + dy * 0.3 + py * bow }
  const overshoot = allowOvershoot ? 1.05 : 0.9
  const c2 = {
    x: from.x + dx * overshoot + px * bow * 0.5,
    y: from.y + dy * overshoot + py * bow * 0.5
  }

  const path: CursorPathStep[] = []
  for (let i = 1; i <= steps; i++) {
    const t = easeOutQuint(i / steps)
    const mt = 1 - t
    const x = mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * to.x
    const y = mt * mt * mt * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * to.y
    path.push({ x: round(x), y: round(y), at: Math.round((i / steps) * duration) })
  }
  // Why: the last sample must land exactly on the target so the click point
  // and the final hover position never disagree by a rounding error.
  path[path.length - 1] = { x: round(to.x), y: round(to.y), at: Math.round(duration) }
  return path
}
