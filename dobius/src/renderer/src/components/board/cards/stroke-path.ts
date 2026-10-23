// Pure SVG helpers for pen strokes.

export function strokePathData(points: readonly [number, number][]): string {
  if (points.length === 0) {
    return ''
  }
  const [first, ...rest] = points
  // Why: a single tap still needs a visible dot, so repeat the point.
  const tail = rest.length > 0 ? rest : [first]
  return `M${first[0]} ${first[1]}${tail.map(([x, y]) => ` L${x} ${y}`).join('')}`
}

export function strokeViewBox(points: readonly [number, number][]): string {
  if (points.length === 0) {
    return '0 0 1 1'
  }
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return `${minX} ${minY} ${Math.max(1, Math.max(...xs) - minX)} ${Math.max(1, Math.max(...ys) - minY)}`
}
