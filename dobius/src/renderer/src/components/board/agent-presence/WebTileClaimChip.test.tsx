// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCursorEvent } from '../../../../../shared/agent-cursor'
import { WebTileClaimChip } from './WebTileClaimChip'
import {
  AGENT_CLAIM_TTL_MS,
  applyAgentCursorEvent,
  markAgentControl,
  markTileYield,
  resetAgentPresenceForTest
} from './agent-presence-state'

const { controlMock } = vi.hoisted(() => ({ controlMock: vi.fn() }))

function click(seq: number): AgentCursorEvent {
  return {
    agentId: 'adam',
    name: 'Adam',
    color: '',
    kind: 'click',
    target: { tileId: 'tile-1', x: 1, y: 1 },
    seq,
    ts: 1_000
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  resetAgentPresenceForTest()
  controlMock.mockReset().mockResolvedValue({ ok: true })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { agents: { control: controlMock } }
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('WebTileClaimChip', () => {
  it('shows "working here" and drops it 3 s after the last action', () => {
    render(<WebTileClaimChip cardId="tile-1" />)
    act(() => {
      applyAgentCursorEvent(click(1))
    })
    expect(screen.getByText('Adam is working here')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(AGENT_CLAIM_TTL_MS + 10)
    })
    expect(screen.queryByText('Adam is working here')).toBeNull()
    expect(document.querySelector('[data-agent-claim]')).toBeNull()
  })

  it('a plain yield reads "waiting for you" with no Resume and clears at until', () => {
    render(<WebTileClaimChip cardId="tile-1" />)
    act(() => {
      applyAgentCursorEvent(click(1))
      markTileYield('tile-1', Date.now() + 5_000)
    })
    expect(screen.getByText('Adam is waiting for you')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(5_010)
    })
    expect(screen.queryByText('Adam is waiting for you')).toBeNull()
  })

  it('an explicit take over shows the Resume chip, and Resume sends resume', () => {
    render(<WebTileClaimChip cardId="tile-1" />)
    act(() => {
      applyAgentCursorEvent(click(1))
      markAgentControl('adam', 'takeOver')
    })
    expect(screen.getByText('You took over — resume Adam?')).toBeTruthy()
    act(() => {
      screen.getByRole('button', { name: 'Resume' }).click()
    })
    expect(controlMock).toHaveBeenCalledWith({ agentId: 'adam', action: 'resume' })
    expect(screen.queryByText('You took over — resume Adam?')).toBeNull()
  })
})
