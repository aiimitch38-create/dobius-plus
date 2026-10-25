import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentCursorEvent } from '../../../../../shared/agent-cursor'
import {
  handleAgentCursorEvent,
  resetAgentCursorInboxForTest,
  subscribeAgentCursor
} from './agent-cursor-inbox'

const event: AgentCursorEvent = {
  agentId: 'adam',
  name: 'Adam',
  color: 'oklch(0.56 0.17 255)',
  kind: 'hover',
  target: { tileId: 'card-1', x: 5, y: 6 },
  seq: 3,
  ts: 42
}

describe('agent cursor inbox', () => {
  afterEach(() => resetAgentCursorInboxForTest())

  it('fans an event out to every subscriber until unsubscribed', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeAgentCursor(a)
    subscribeAgentCursor(b)
    handleAgentCursorEvent(event)
    expect(a).toHaveBeenCalledWith(event)
    expect(b).toHaveBeenCalledWith(event)
    offA()
    handleAgentCursorEvent({ ...event, seq: 4 })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('isolates a throwing subscriber', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ok = vi.fn()
    subscribeAgentCursor(() => {
      throw new Error('boom')
    })
    subscribeAgentCursor(ok)
    expect(() => handleAgentCursorEvent(event)).not.toThrow()
    expect(ok).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })
})
