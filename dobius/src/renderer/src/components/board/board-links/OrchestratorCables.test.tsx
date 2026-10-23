// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardCable } from './board-link-geometry'
import { OrchestratorCables } from './OrchestratorCables'

const live = vi.hoisted(() => ({ workingTabs: new Set<string>(), reducedMotion: false }))
vi.mock('../console-card/use-console-card-status', () => ({
  useConsoleCardStatus: (_worktreeId: string, tabId: string) => ({
    status: live.workingTabs.has(tabId) ? 'working' : 'idle',
    lastReply: null
  })
}))
vi.mock('@/hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => live.reducedMotion
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const cable: BoardCable = {
  id: 'orchestrator->group',
  orchestratorId: 'orchestrator',
  from: { x: 0, y: 0, w: 100, h: 100 },
  to: { x: 400, y: 0, w: 300, h: 100 },
  targetTabIds: ['tab-a', 'tab-b']
}
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  live.workingTabs.clear()
  live.reducedMotion = false
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(cables = [cable], zoom = 1): void {
  act(() =>
    root.render(
      <svg>
        <OrchestratorCables worktreeId="worktree" cables={cables} zoom={zoom} />
      </svg>
    )
  )
}

describe('OrchestratorCables', () => {
  it('uses one slow packet while idle and three faster packets when any group member works', () => {
    render()
    expect(container.querySelectorAll('animateMotion')).toHaveLength(1)
    expect(container.querySelector('animateMotion')?.getAttribute('dur')).toBe('3s')
    expect(container.querySelector('.board-orchestrator-cable')?.getAttribute('opacity')).toBe(
      '0.7'
    )

    live.workingTabs.add('tab-b')
    render()
    const motions = [...container.querySelectorAll('animateMotion')]
    expect(motions.map((motion) => motion.getAttribute('dur'))).toEqual(['2.25s', '2.25s', '2.25s'])
    expect(motions.map((motion) => motion.getAttribute('begin'))).toEqual(['0s', '-0.75s', '-1.5s'])
    expect(container.querySelector('.board-orchestrator-cable')?.getAttribute('opacity')).toBe('1')
    const pathId = container.querySelector('path[id]')?.id
    expect(
      [...container.querySelectorAll('mpath')].every((p) => p.getAttribute('href') === `#${pathId}`)
    ).toBe(true)

    live.workingTabs.clear()
    render()
    expect(container.querySelectorAll('animateMotion')).toHaveLength(1)
  })

  it('removes packet animations for reduced motion while preserving the cable and plugs', () => {
    live.workingTabs.add('tab-a')
    render()
    expect(container.querySelectorAll('animateMotion')).toHaveLength(3)
    live.reducedMotion = true
    render()
    expect(container.querySelectorAll('animateMotion, .board-cable-packet')).toHaveLength(0)
    expect(container.querySelectorAll('path')).toHaveLength(2)
    expect(container.querySelectorAll('circle')).toHaveLength(3)
  })

  it('drops working activity when that target is unwired', () => {
    live.workingTabs.add('tab-b')
    render()
    render([{ ...cable, targetTabIds: ['tab-a'] }])
    expect(container.querySelector('.board-orchestrator-cable')?.getAttribute('data-working')).toBe(
      'false'
    )
    expect(container.querySelectorAll('animateMotion')).toHaveLength(1)
  })

  it.each([0.5, 1, 2])('preserves screen-space cable and plug sizes at zoom %s', (zoom) => {
    render([cable], zoom)
    expect(Number(container.querySelector('path[id]')?.getAttribute('stroke-width')) * zoom).toBe(
      2.5
    )
    expect(
      Number(container.querySelector('.board-cable-target-dot')?.getAttribute('r')) * zoom
    ).toBe(4)
    expect(container.querySelector('[stroke-dasharray], [marker-end]')).toBeNull()
  })
})
