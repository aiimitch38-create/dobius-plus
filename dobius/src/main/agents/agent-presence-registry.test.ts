import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentPresenceRegistry,
  HUMAN_YIELD_MS,
  TILE_CLAIM_TTL_MS
} from './agent-presence-registry'

describe('AgentPresenceRegistry', () => {
  let registry: AgentPresenceRegistry
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    registry = new AgentPresenceRegistry()
  })
  afterEach(() => {
    registry.resetForTest()
    vi.useRealTimers()
  })

  it('clears a free tile immediately', async () => {
    await expect(registry.awaitAgentClearance('adam', 't1')).resolves.toBe('ok')
  })

  it('pause blocks clearance until resume', async () => {
    registry.control({ agentId: 'adam', action: 'pause' }, 'renderer')
    await expect(registry.awaitAgentClearance('adam', 't1', 0)).resolves.toBe('paused')
    const waiting = registry.awaitAgentClearance('adam', 't1', 5_000)
    await vi.advanceTimersByTimeAsync(500)
    registry.control({ agentId: 'adam', action: 'resume' }, 'renderer')
    await expect(waiting).resolves.toBe('ok')

    registry.control({ agentId: 'adam', action: 'pause' }, 'renderer')
    const timedOut = registry.awaitAgentClearance('adam', 't1', 1_000)
    await vi.advanceTimersByTimeAsync(1_200)
    await expect(timedOut).resolves.toBe('paused')
  })

  it('takeOver reads as paused and resume clears it', async () => {
    registry.control({ agentId: 'adam', action: 'takeOver' }, 'renderer')
    expect(registry.clearance('adam', 't1')).toBe('paused')
    registry.control({ agentId: 'adam', action: 'resume' }, 'renderer')
    expect(registry.getState('adam')).toEqual({ paused: false, stopped: false, takenOverUntil: 0 })
  })

  it('stop returns immediately and does not wait', async () => {
    registry.control({ agentId: 'adam', action: 'stop' }, 'renderer')
    await expect(registry.awaitAgentClearance('adam', 't1', 10_000)).resolves.toBe('stopped')
  })

  it('a human yield expires after 5 s', async () => {
    registry.yieldTile('t1')
    expect(registry.clearance('adam', 't1')).toBe('yielding')
    expect(registry.clearance('adam', 't2')).toBe('ok')
    const waiting = registry.awaitAgentClearance('adam', 't1', 20_000)
    await vi.advanceTimersByTimeAsync(HUMAN_YIELD_MS - 200)
    expect(registry.isYielding('t1')).toBe(true)
    await vi.advanceTimersByTimeAsync(400)
    await expect(waiting).resolves.toBe('ok')
    expect(registry.isYielding('t1')).toBe(false)
  })

  it('tile claims block other agents and expire after 3 s', () => {
    expect(registry.claimTile('adam', 't1')).toEqual({ ok: true, until: 1_000_000 + TILE_CLAIM_TTL_MS })
    expect(registry.claimTile('maya', 't1')).toEqual({ ok: false, heldBy: 'adam' })
    expect(registry.clearance('maya', 't1')).toBe('yielding')
    expect(registry.clearance('adam', 't1')).toBe('ok')
    vi.setSystemTime(1_000_000 + TILE_CLAIM_TTL_MS - 1)
    expect(registry.getTileClaim('t1')).toEqual({ agentId: 'adam', until: 1_000_000 + TILE_CLAIM_TTL_MS })
    vi.setSystemTime(1_000_000 + TILE_CLAIM_TTL_MS)
    expect(registry.getTileClaim('t1')).toBeNull()
    expect(registry.claimTile('maya', 't1').ok).toBe(true)
  })

  it('stop drops the agent\'s claims', () => {
    registry.claimTile('adam', 't1')
    registry.control({ agentId: 'adam', action: 'stop' }, 'renderer')
    expect(registry.getTileClaim('t1')).toBeNull()
  })

  it('gate approval resolves on approve, deny, timeout and stop', async () => {
    const approved = registry.requestGateApproval('adam', { kind: 'send', requestId: 'g1' })
    expect(registry.pendingGates()).toEqual([{ requestId: 'g1', agentId: 'adam' }])
    // Why: another agent must not be able to approve Adam's gate.
    expect(registry.control({ agentId: 'maya', action: 'approve', requestId: 'g1' }, 'renderer').ok).toBe(false)
    expect(registry.control({ agentId: 'adam', action: 'approve', requestId: 'g1' }, 'renderer')).toMatchObject({
      ok: true,
      gateResolved: true
    })
    await expect(approved).resolves.toBe(true)

    const denied = registry.requestGateApproval('adam', { kind: 'delete', requestId: 'g2' })
    registry.control({ agentId: 'adam', action: 'deny', requestId: 'g2' }, 'renderer')
    await expect(denied).resolves.toBe(false)
    expect(registry.control({ agentId: 'adam', action: 'approve', requestId: 'g2' }, 'renderer').ok).toBe(false)

    const timedOut = registry.requestGateApproval('adam', { kind: 'login', requestId: 'g3' }, 1_000)
    await vi.advanceTimersByTimeAsync(1_001)
    await expect(timedOut).resolves.toBe(false)

    const stopped = registry.requestGateApproval('adam', { kind: 'purchase', requestId: 'g4' })
    registry.control({ agentId: 'adam', action: 'stop' }, 'renderer')
    await expect(stopped).resolves.toBe(false)
    await expect(
      registry.requestGateApproval('adam', { kind: 'purchase', requestId: 'g5' })
    ).resolves.toBe(false)
  })

  it('rejects junk control and yield input', () => {
    expect(() => registry.control({ agentId: 'Adam', action: 'pause' }, 'renderer')).toThrow()
    expect(() => registry.control({ agentId: 'adam', action: 'nuke' } as never, 'renderer')).toThrow()
    expect(() => registry.parseControl({ agentId: 'adam', action: 'pause', extra: 1 })).toThrow()
    expect(() => registry.parseYield({})).toThrow()
    expect(registry.parseYield({ cardId: 'c1' })).toEqual({ cardId: 'c1' })
  })
})
