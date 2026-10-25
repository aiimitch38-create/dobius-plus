// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { AgentCursorEvent } from '../../../../../shared/agent-cursor'
import { AgentPresenceStrip } from './AgentPresenceStrip'
import {
  applyAgentCursorEvent,
  resetAgentPresenceForTest,
  setFollowedAgent,
  useAgentPresence
} from './agent-presence-state'

const { controlMock, focusMock, storeMock } = vi.hoisted(() => ({
  controlMock: vi.fn(),
  focusMock: vi.fn(),
  storeMock: {
    cards: [] as Array<{ id: string; kind: string; title: string; url?: string }>
  }
}))

vi.mock('@/store', () => ({
  useAppStore: create(() => ({ activeWorktreeId: 'wt-1' }))
}))
vi.mock('@/store/slices/board', () => ({
  getBoard: () => ({ cards: storeMock.cards })
}))
vi.mock('../board-canvas/board-camera-focus', () => ({ focusBoardCard: focusMock }))

function event(partial: Partial<AgentCursorEvent> & { seq: number }): AgentCursorEvent {
  return {
    agentId: 'adam',
    name: 'Adam',
    color: '',
    kind: 'click',
    target: { tileId: 'tile-1', x: 4, y: 4 },
    ts: 1_000,
    ...partial
  }
}

beforeEach(() => {
  resetAgentPresenceForTest()
  controlMock.mockReset().mockResolvedValue({ ok: true })
  focusMock.mockReset()
  storeMock.cards = [{ id: 'tile-1', kind: 'web', title: 'Shop', url: 'https://shop.example.com/cart' }]
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { agents: { control: controlMock } }
  })
})

afterEach(() => cleanup())

describe('AgentPresenceStrip', () => {
  it('renders nothing until an agent shows up', () => {
    const { container } = render(<AgentPresenceStrip />)
    expect(container.querySelector('[data-agent-presence-strip]')).toBeNull()
  })

  it('shows the approval card for a gated event and sends approve with the request id', () => {
    render(<AgentPresenceStrip />)
    act(() => {
      applyAgentCursorEvent(event({ seq: 1, gated: { kind: 'purchase', requestId: 'req-7' } }))
    })
    expect(screen.getByText('Adam wants to make a purchase on shop.example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(controlMock).toHaveBeenCalledWith({
      agentId: 'adam',
      action: 'approve',
      requestId: 'req-7'
    })
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('sends deny with the request id', () => {
    render(<AgentPresenceStrip />)
    act(() => {
      applyAgentCursorEvent(event({ seq: 1, gated: { kind: 'send', requestId: 'req-8' } }))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(controlMock).toHaveBeenCalledWith({ agentId: 'adam', action: 'deny', requestId: 'req-8' })
  })

  it('pauses, resumes and follows', () => {
    render(<AgentPresenceStrip />)
    act(() => {
      applyAgentCursorEvent(event({ seq: 1 }))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(controlMock).toHaveBeenLastCalledWith({ agentId: 'adam', action: 'pause' })
    expect(useAgentPresence.getState().agents.adam.paused).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(controlMock).toHaveBeenLastCalledWith({ agentId: 'adam', action: 'resume' })
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }))
    expect(useAgentPresence.getState().followAgentId).toBe('adam')
    expect(focusMock).toHaveBeenCalledWith('wt-1', 'tile-1')
    expect(document.querySelector('[data-agent-following="adam"]')).not.toBeNull()
    act(() => setFollowedAgent(null))
    expect(document.querySelector('[data-agent-following]')).toBeNull()
  })

  it('a stopped agent keeps Resume enabled, offers Dismiss, and disables the rest', () => {
    render(<AgentPresenceStrip />)
    act(() => {
      applyAgentCursorEvent(event({ seq: 1 }))
      applyAgentCursorEvent(event({ seq: 2, kind: 'stopped', target: undefined }))
    })
    const resume = screen.getByRole<HTMLButtonElement>('button', { name: 'Resume' })
    expect(resume.disabled).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Stop' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Take over' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Follow' }).disabled).toBe(true)
    fireEvent.click(resume)
    expect(controlMock).toHaveBeenLastCalledWith({ agentId: 'adam', action: 'resume' })
    act(() => {
      applyAgentCursorEvent(event({ seq: 3, kind: 'stopped', target: undefined }))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(document.querySelector('[data-agent-row="adam"]')).toBeNull()
  })
})
