import type { BoardPoint } from '../board-canvas/board-viewport'

const MIN_EXTENT = 4

/**
 * World-space pen points → a stroke card whose bounds are the points' bounds
 * and whose points are relative to that origin (the card model's contract).
 */
export function strokeCardFromWorldPoints(points: readonly BoardPoint[]): {
  x: number
  y: number
  w: number
  h: number
  points: [number, number][]
} | null {
  if (points.length === 0) {
    return null
  }
  const minX = Math.min(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y))
  const maxX = Math.max(...points.map((p) => p.x))
  const maxY = Math.max(...points.map((p) => p.y))
  return {
    x: minX,
    y: minY,
    w: Math.max(MIN_EXTENT, maxX - minX),
    h: Math.max(MIN_EXTENT, maxY - minY),
    points: points.map((p) => [p.x - minX, p.y - minY])
  }
}
