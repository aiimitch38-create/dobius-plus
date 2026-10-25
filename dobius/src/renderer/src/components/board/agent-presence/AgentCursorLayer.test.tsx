// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCursorEvent } from '../../../../../shared/agent-cursor'
import { AgentCursorLayer } from './AgentCursorLayer'
import { handleAgentCursorEvent, resetAgentCursorInboxForTest } from './agent-cursor-inbox'
import { resetAgentPresenceForTest } from './agent-presence-state'

describe('AgentCursorLayer frame loop', () => {
  it('schedules no animation frame with zero agents and starts once a pointer appears', () => {
    resetAgentPresenceForTest()
    resetAgentCursorInboxForTest()
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    render(<AgentCursorLayer />)
    expect(raf).not.toHaveBeenCalled()
    act(() => {
      handleAgentCursorEvent(event({ agentId: 'adam', seq: 1 }))
    })
    expect(raf).toHaveBeenCalled()
    raf.mockRestore()
    cleanup()
  })
})

function event(partial: Partial<AgentCursorEvent> & { agentId: string; seq: number }): AgentCursorEvent {
  return {
    name: partial.agentId === 'adam' ? 'Adam' : 'Eve',
    color: '',
    kind: 'move',
    target: { window: true, x: 100, y: 100 },
    ts: 1_000,
    ...partial
  }
}

beforeEach(() => {
  resetAgentPresenceForTest()
  resetAgentCursorInboxForTest()
})

afterEach(() => cleanup())

describe('AgentCursorLayer', () => {
  it('renders two agents with distinct palette colors and never takes pointer events', () => {
    const { container } = render(<AgentCursorLayer />)
    act(() => {
      handleAgentCursorEvent(event({ agentId: 'adam', seq: 1 }))
      handleAgentCursorEvent(event({ agentId: 'eve', seq: 1, target: { window: true, x: 300, y: 50 } }))
    })
    const cursors = container.querySelectorAll<HTMLElement>('[data-agent-id]')
    expect(cursors).toHaveLength(2)
    const colors = [...cursors].map((el) => el.style.color)
    expect(colors[0]).toMatch(/^var\(--agent-\d\)$/)
    expect(colors[1]).toMatch(/^var\(--agent-\d\)$/)
    expect(new Set(colors).size).toBe(2)
    const layer = container.querySelector('[data-agent-cursor-layer]')
    expect(layer?.className).toContain('pointer-events-none')
    expect(layer?.querySelectorAll('button')).toHaveLength(0)
  })

  it('shows a click ripple for a click event and a typing pill for type', () => {
    const { container } = render(<AgentCursorLayer />)
    act(() => {
      handleAgentCursorEvent(event({ agentId: 'adam', seq: 1 }))
      handleAgentCursorEvent(event({ agentId: 'adam', seq: 2, kind: 'click' }))
    })
    expect(container.querySelector('[data-agent-ripple="click"]')).not.toBeNull()
    act(() => {
      handleAgentCursorEvent(event({ agentId: 'adam', seq: 3, kind: 'type', text: 'hello' }))
    })
    expect(container.querySelectorAll('[data-agent-dot]')).toHaveLength(3)
  })

  it('hides a stopped agent pointer but applies a duplicate seq only once', () => {
    const { container } = render(<AgentCursorLayer />)
    act(() => {
      handleAgentCursorEvent(event({ agentId: 'adam', seq: 1, kind: 'click' }))
      handleAgentCursorEvent(event({ agentId: 'adam', seq: 1, kind: 'click' }))
      handleAgentCursorEvent(event({ agentId: 'adam', seq: 2, kind: 'stopped' }))
    })
    expect(container.querySelectorAll('[data-agent-id]')).toHaveLength(0)
  })
})
