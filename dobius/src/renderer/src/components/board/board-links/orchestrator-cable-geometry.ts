import type { Rect } from '../cards/card-geometry'
import type { BoardPointXY } from './board-link-geometry'

type CablePort = BoardPointXY & { normal: BoardPointXY }
export type CableRoute = {
  start: CablePort
  end: CablePort
  control1: BoardPointXY
  control2: BoardPointXY
  path: string
}

function ports(rect: Rect): CablePort[] {
  const x = rect.x + rect.w / 2
  const y = rect.y + rect.h / 2
  return [
    { x: rect.x + rect.w, y, normal: { x: 1, y: 0 } },
    { x: rect.x, y, normal: { x: -1, y: 0 } },
    { x, y: rect.y + rect.h, normal: { x: 0, y: 1 } },
    { x, y: rect.y, normal: { x: 0, y: -1 } }
  ]
}

function facingPorts(rect: Rect, toward: Rect): CablePort[] {
  const dx = toward.x + toward.w / 2 - (rect.x + rect.w / 2)
  const dy = toward.y + toward.h / 2 - (rect.y + rect.h / 2)
  return ports(rect).filter((port) => port.normal.x * dx + port.normal.y * dy > 0)
}

/** Closest facing side midpoints, with control handles normal to each side. */
export function orchestratorCableRoute(from: Rect, to: Rect): CableRoute {
  // Why: coincident/overlapping cards can occur while dragging; keep the route finite
  // and deterministic even when there is no distinct direction between their centres.
  let start = ports(from)[0]
  let end = ports(to)[1]
  let nearest = Infinity
  for (const source of facingPorts(from, to)) {
    for (const target of facingPorts(to, from)) {
      const distance = (target.x - source.x) ** 2 + (target.y - source.y) ** 2
      if (distance < nearest) {
        start = source
        end = target
        nearest = distance
      }
    }
  }
  const bend = Math.max(24, Math.hypot(end.x - start.x, end.y - start.y) / 2)
  const control1 = {
    x: start.x + start.normal.x * bend,
    y: start.y + start.normal.y * bend
  }
  const control2 = {
    x: end.x + end.normal.x * bend,
    y: end.y + end.normal.y * bend
  }
  return {
    start,
    end,
    control1,
    control2,
    path: `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`
  }
}
