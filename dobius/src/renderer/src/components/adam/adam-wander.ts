export type Position = { x: number; y: number }
export type Viewport = { width: number; height: number }

/** Default landing spot when Adam first wakes — near the top-left, clear of
 *  the titlebar. Used before the viewport is known and as the wander anchor. */
export const ADAM_SETTLE_POSITION: Position = { x: 32, y: 72 }

export function clampAdamPosition(pos: Position, size: number, viewport: Viewport): Position {
  const maxX = Math.max(0, viewport.width - size)
  const maxY = Math.max(0, viewport.height - size)
  return {
    x: Math.min(Math.max(0, pos.x), maxX),
    y: Math.min(Math.max(0, pos.y), maxY)
  }
}

/**
 * Picks Adam's next idle-wander destination. Carson wants him "mostly" in
 * the top-left, not roaming the whole window, so the sampled region is
 * capped well short of the full viewport, and each axis is biased toward
 * its low end by taking the min of two uniform samples (a cheap, well-known
 * skew-toward-zero trick) rather than a flat distribution.
 */
export function pickAdamWanderTarget(
  size: number,
  viewport: Viewport,
  rng: () => number = Math.random
): Position {
  const regionW = Math.max(size, Math.min(viewport.width * 0.42, viewport.width - size))
  const regionH = Math.max(size, Math.min(viewport.height * 0.55, viewport.height - size))
  const biasedX = Math.min(rng(), rng())
  const biasedY = Math.min(rng(), rng())
  return clampAdamPosition(
    {
      x: Math.round(biasedX * (regionW - size)),
      y: Math.round(biasedY * (regionH - size))
    },
    size,
    viewport
  )
}
