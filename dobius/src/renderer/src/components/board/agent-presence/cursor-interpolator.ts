// Sparse agent `move` points in, smooth motion out. perfect-cursors (MIT) runs
// the spline once three points are buffered; before that a critically damped
// spring carries the pointer so the first moves do not snap. Positions stay in
// the target's own space (guest px or window px); the layer projects per frame.
import { PerfectCursor } from 'perfect-cursors'

/** Research §6.2: the pointer never lags more than one throttle interval. */
export const CURSOR_MAX_BUFFERED_MS = 120
const SPLINE_AFTER_POINTS = 3
const SPRING_STIFFNESS = 300
const SPRING_DAMPING = 30
const SPRING_SETTLE_PX = 0.1
const MAX_STEP_S = 1 / 30

PerfectCursor.MAX_INTERVAL = CURSOR_MAX_BUFFERED_MS

export type InterpolatedPoint = { x: number; y: number }

export class CursorInterpolator {
  current: InterpolatedPoint | null = null
  private points = 0
  private target: InterpolatedPoint | null = null
  private velocity = { x: 0, y: 0 }
  private spline: PerfectCursor | null = null

  constructor(private readonly reducedMotion: boolean) {}

  setTarget(x: number, y: number): void {
    this.target = { x, y }
    if (this.reducedMotion || this.current === null) {
      this.current = { x, y }
      this.velocity = { x: 0, y: 0 }
      this.points = this.reducedMotion ? 0 : 1
      return
    }
    this.points += 1
    if (this.points >= SPLINE_AFTER_POINTS) {
      if (!this.spline) {
        this.spline = new PerfectCursor((point) => {
          this.current = { x: point[0], y: point[1] }
        })
        this.spline.addPoint([this.current.x, this.current.y])
      }
      this.spline.addPoint([x, y])
    }
  }

  /** Advances the spring (only used until the spline takes over). */
  tick(dtMs: number): void {
    if (this.spline || !this.target || !this.current) {
      return
    }
    const dt = Math.min(dtMs / 1000, MAX_STEP_S)
    const axes = ['x', 'y'] as const
    for (const axis of axes) {
      const displacement = this.current[axis] - this.target[axis]
      const accel = -SPRING_STIFFNESS * displacement - SPRING_DAMPING * this.velocity[axis]
      this.velocity[axis] += accel * dt
      this.current[axis] += this.velocity[axis] * dt
    }
    if (
      Math.abs(this.current.x - this.target.x) < SPRING_SETTLE_PX &&
      Math.abs(this.current.y - this.target.y) < SPRING_SETTLE_PX
    ) {
      this.current = { ...this.target }
      this.velocity = { x: 0, y: 0 }
    }
  }

  dispose(): void {
    this.spline?.dispose()
    this.spline = null
  }
}
