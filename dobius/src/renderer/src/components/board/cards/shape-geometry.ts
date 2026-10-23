import type { BoardLineDirection, BoardShapeKind } from '@/store/slices/board'

// Pure SVG geometry for shape cards, in the card's own pixel space (0..w, 0..h)
// so stroke widths and hand-drawn wobble are real pixels at any card size.

type Pt = [number, number]

/** Deterministic pseudo-random in [-1, 1] so a sloppy shape never shimmers between renders. */
function noise(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

export function shapeSeed(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return Math.abs(h % 1000) + 1
}

function wobble(points: readonly Pt[], amount: number, seed: number): Pt[] {
  return amount === 0
    ? points.map((p) => [p[0], p[1]] as Pt)
    : points.map(
        (p, i) => [p[0] + noise(seed, i * 2) * amount, p[1] + noise(seed, i * 2 + 1) * amount] as Pt
      )
}

/** Splits each edge so a wobble bends the side, not just the corners. */
function subdivide(points: readonly Pt[], closed: boolean, steps: number): Pt[] {
  const out: Pt[] = []
  const n = closed ? points.length : points.length - 1
  for (let i = 0; i < n; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    for (let s = 0; s < steps; s += 1) {
      out.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps])
    }
  }
  if (!closed) {
    out.push(points.at(-1)!)
  }
  return out
}

function toPath(points: readonly Pt[], closed: boolean): string {
  const [first, ...rest] = points
  const d = `M${first[0].toFixed(2)} ${first[1].toFixed(2)}${rest.map((p) => ` L${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('')}`
  return closed ? `${d} Z` : d
}

/** Start and end corners for a line pointing toward `direction`. */
export function lineEnds(
  direction: BoardLineDirection,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): [Pt, Pt] {
  switch (direction) {
    case 'se':
      return [
        [x0, y0],
        [x1, y1]
      ]
    case 'sw':
      return [
        [x1, y0],
        [x0, y1]
      ]
    case 'nw':
      return [
        [x1, y1],
        [x0, y0]
      ]
    case 'ne':
      return [
        [x0, y1],
        [x1, y0]
      ]
  }
}

/** Next direction for the "Turn direction" card action (clockwise). */
export function nextLineDirection(direction: BoardLineDirection | undefined): BoardLineDirection {
  const order: BoardLineDirection[] = ['se', 'sw', 'nw', 'ne']
  return order[(order.indexOf(direction ?? 'se') + 1) % order.length]
}

export type ShapeGeometry = { d: string; closed: boolean; arrowHead: string | null }

/**
 * Path for a shape kind inside a w x h box, inset by half the stroke so the
 * stroke stays inside the card. `wobblePx` 0 gives ruler-straight lines.
 * Lines and arrows run corner to corner toward `direction` (default top-left to bottom-right).
 */
export function shapeGeometry(
  shape: BoardShapeKind,
  w: number,
  h: number,
  strokePx: number,
  wobblePx: number,
  seed: number,
  direction: BoardLineDirection = 'se'
): ShapeGeometry {
  const i = strokePx / 2 + wobblePx
  const x0 = i
  const y0 = i
  const x1 = Math.max(i, w - i)
  const y1 = Math.max(i, h - i)
  const cx = w / 2
  const cy = h / 2
  const steps = wobblePx === 0 ? 1 : 4
  const closedPath = (pts: Pt[]): ShapeGeometry => ({
    d: toPath(wobble(subdivide(pts, true, steps), wobblePx, seed), true),
    closed: true,
    arrowHead: null
  })
  switch (shape) {
    case 'rect':
      return closedPath([
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1]
      ])
    case 'diamond':
      return closedPath([
        [cx, y0],
        [x1, cy],
        [cx, y1],
        [x0, cy]
      ])
    case 'triangle':
      return closedPath([
        [cx, y0],
        [x1, y1],
        [x0, y1]
      ])
    case 'ellipse': {
      const pts: Pt[] = Array.from({ length: 32 }, (_, k) => {
        const t = (k / 32) * Math.PI * 2
        return [cx + Math.cos(t) * (cx - i), cy + Math.sin(t) * (cy - i)]
      })
      return { d: toPath(wobble(pts, wobblePx, seed), true), closed: true, arrowHead: null }
    }
    case 'line':
    case 'arrow': {
      const line = wobble(
        subdivide(lineEnds(direction, x0, y0, x1, y1), false, steps),
        wobblePx,
        seed
      )
      return {
        d: toPath(line, false),
        closed: false,
        arrowHead: shape === 'arrow' ? arrowHeadPath([x0, y0], [x1, y1], strokePx) : null
      }
    }
  }
}

/** Two short barbs at `to`, angled back along the line. */
export function arrowHeadPath(from: Pt, to: Pt, strokePx: number): string {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
  const len = Math.max(10, strokePx * 5)
  const spread = Math.PI / 7
  const a: Pt = [to[0] - len * Math.cos(angle - spread), to[1] - len * Math.sin(angle - spread)]
  const b: Pt = [to[0] - len * Math.cos(angle + spread), to[1] - len * Math.sin(angle + spread)]
  return `M${a[0].toFixed(2)} ${a[1].toFixed(2)} L${to[0].toFixed(2)} ${to[1].toFixed(2)} L${b[0].toFixed(2)} ${b[1].toFixed(2)}`
}
