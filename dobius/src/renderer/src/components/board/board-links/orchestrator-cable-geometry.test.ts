import { describe, expect, it } from 'vitest'
import type { Rect } from '../cards/card-geometry'
import { orchestratorCableRoute } from './orchestrator-cable-geometry'

const card: Rect = { x: 0, y: 0, w: 100, h: 80 }

describe('orchestratorCableRoute', () => {
  it.each([
    ['right', { x: 300, y: 0, w: 200, h: 80 }, [100, 40], [300, 40]],
    ['left', { x: -300, y: 0, w: 100, h: 80 }, [0, 40], [-200, 40]],
    ['below', { x: 0, y: 300, w: 100, h: 80 }, [50, 80], [50, 300]],
    ['above', { x: 0, y: -300, w: 100, h: 80 }, [50, 0], [50, -220]]
  ] as const)('plugs into side midpoints for a target %s', (_, target, start, end) => {
    const route = orchestratorCableRoute(card, target)
    expect([route.start.x, route.start.y]).toEqual(start)
    expect([route.end.x, route.end.y]).toEqual(end)
  })

  it('chooses the closest facing midpoints for offset rectangles', () => {
    const route = orchestratorCableRoute(card, { x: 300, y: 100, w: 100, h: 400 })
    expect(route.start).toMatchObject({ x: 100, y: 40 })
    expect(route.end).toMatchObject({ x: 350, y: 100 })
    // Each tangent must leave its own side normally, including mixed side pairs.
    expect(route.control1.y).toBe(route.start.y)
    expect(route.control1.x).toBeGreaterThan(route.start.x)
    expect(route.control2.x).toBe(route.end.x)
    expect(route.control2.y).toBeLessThan(route.end.y)
  })

  it('meets a wide group at its facing side centre instead of its corner', () => {
    const route = orchestratorCableRoute(card, { x: 300, y: -160, w: 700, h: 400 })
    expect(route.end).toMatchObject({ x: 300, y: 40 })
    expect(route.path).toBe('M 100 40 C 200 40, 200 40, 300 40')
  })

  it('reverses the same ports and handles when the source and target swap', () => {
    const target = { x: -250, y: -200, w: 90, h: 170 }
    const forward = orchestratorCableRoute(card, target)
    const reverse = orchestratorCableRoute(target, card)
    expect(reverse.start).toEqual(forward.end)
    expect(reverse.end).toEqual(forward.start)
    expect(reverse.control1).toEqual(forward.control2)
    expect(reverse.control2).toEqual(forward.control1)
  })

  it('keeps coincident and touching rectangles finite and deterministic', () => {
    for (const target of [card, { ...card, x: card.w }]) {
      const route = orchestratorCableRoute(card, target)
      expect(route.path).not.toMatch(/NaN|Infinity/)
      expect(orchestratorCableRoute(card, target)).toEqual(route)
      expect(route.control1.x - route.start.x).toBeGreaterThanOrEqual(24)
    }
  })
})
