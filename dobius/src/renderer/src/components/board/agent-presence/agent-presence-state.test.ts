import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentCursorEvent } from '../../../../../shared/agent-cursor'
import {
  AGENT_CLAIM_TTL_MS,
  AGENT_IDLE_AFTER_MS,
  AGENT_TILE_LIVE_MS,
  AUTO_FOLLOW_SUPPRESS_MS,
  AUTO_FOLLOW_USER_GRACE_MS,
  agentLiveOnTile,
  applyAgentCursorEvent,
  claimActive,
  claimantOfTile,
  markAgentControl,
  markTileYield,
  noteUserCameraInteraction,
  removeAgent,
  resetAgentPresenceForTest,
  setAutoFollowEnabled,
  stopFollowingByUser,
  tickAgentPresence,
  useAgentPresence
} from './agent-presence-state'

function event(partial: Partial<AgentCursorEvent> & { seq: number }): AgentCursorEvent {
  return {
    agentId: 'adam',
    name: 'Adam',
    color: 'oklch(0.56 0.17 255)',
    kind: 'move',
    target: { tileId: 'tile-1', x: 10, y: 20 },
    ts: 1_000,
    ...partial
  }
}

beforeEach(() => resetAgentPresenceForTest())

describe('applyAgentCursorEvent', () => {
  it('drops a move older than the last seq but keeps newer ones', () => {
    expect(applyAgentCursorEvent(event({ seq: 5 }))).toBe(true)
    expect(applyAgentCursorEvent(event({ seq: 3, target: { tileId: 'tile-1', x: 1, y: 1 } }))).toBe(
      false
    )
    expect(useAgentPresence.getState().agents.adam.pointer).toEqual({
      tileId: 'tile-1',
      x: 10,
      y: 20
    })
    expect(applyAgentCursorEvent(event({ seq: 6, target: { tileId: 'tile-1', x: 2, y: 2 } }))).toBe(
      true
    )
    expect(useAgentPresence.getState().agents.adam.pointer).toEqual({ tileId: 'tile-1', x: 2, y: 2 })
  })

  it('applies a non-move event exactly once by seq, even out of order', () => {
    applyAgentCursorEvent(event({ seq: 10 }))
    expect(applyAgentCursorEvent(event({ seq: 7, kind: 'click' }))).toBe(true)
    expect(applyAgentCursorEvent(event({ seq: 7, kind: 'click' }))).toBe(false)
    expect(useAgentPresence.getState().agents.adam.ripple?.seq).toBe(7)
  })

  it('claims the tile on actions and uses the palette token as the color', () => {
    applyAgentCursorEvent(event({ seq: 1, kind: 'hover', target: { tileId: 'tile-9', x: 0, y: 0, w: 40, h: 20 } }))
    const adam = useAgentPresence.getState().agents.adam
    expect(adam.claimedTileId).toBe('tile-9')
    expect(adam.color).toBe('var(--agent-1)')
    expect(adam.hover).toEqual({ tileId: 'tile-9', x: 0, y: 0, w: 40, h: 20 })
    expect(claimantOfTile('tile-9')?.id).toBe('adam')
  })

  it('records a gate and clears it on approve', () => {
    applyAgentCursorEvent(
      event({ seq: 1, kind: 'click', gated: { kind: 'send', requestId: 'r1' } })
    )
    expect(useAgentPresence.getState().agents.adam.gated).toEqual({ kind: 'send', requestId: 'r1' })
    markAgentControl('adam', 'approve')
    expect(useAgentPresence.getState().agents.adam.gated).toBeNull()
  })
})

describe('presence lifecycle', () => {
  it('goes idle after 60 s without events and releases the claim', () => {
    applyAgentCursorEvent(event({ seq: 1, kind: 'click' }), 0)
    tickAgentPresence(AGENT_IDLE_AFTER_MS - 1)
    expect(useAgentPresence.getState().agents.adam.userState).toBe('active')
    tickAgentPresence(AGENT_IDLE_AFTER_MS)
    const adam = useAgentPresence.getState().agents.adam
    expect(adam.userState).toBe('idle')
    expect(adam.claimedTileId).toBeNull()
  })

  it('a plain yield only holds the agent until `until`; the heartbeat clears it', () => {
    applyAgentCursorEvent(event({ seq: 1, kind: 'type', text: 'hi' }), 1_000)
    expect(markTileYield('tile-1', 6_000)).toEqual(['adam'])
    expect(useAgentPresence.getState().agents.adam).toMatchObject({
      yieldedUntil: 6_000,
      yielded: false,
      paused: false
    })
    expect(claimActive(useAgentPresence.getState().agents.adam, 5_999)).toBe(true)
    tickAgentPresence(6_000)
    expect(useAgentPresence.getState().agents.adam.yieldedUntil).toBeNull()
  })

  it('an explicit take over sets yielded until resume; resume also revives a stopped agent', () => {
    applyAgentCursorEvent(event({ seq: 1, kind: 'click' }))
    markAgentControl('adam', 'takeOver')
    expect(useAgentPresence.getState().agents.adam).toMatchObject({ yielded: true, paused: true })
    markAgentControl('adam', 'stop')
    markAgentControl('adam', 'resume')
    expect(useAgentPresence.getState().agents.adam).toMatchObject({
      yielded: false,
      paused: false,
      stopped: false
    })
    removeAgent('adam')
    expect(useAgentPresence.getState().agents.adam).toBeUndefined()
  })

  it('the claim chip is active for 3 s after the last action', () => {
    applyAgentCursorEvent(event({ seq: 1, kind: 'click' }), 10_000)
    const adam = useAgentPresence.getState().agents.adam
    expect(claimActive(adam, 10_000 + AGENT_CLAIM_TTL_MS - 1)).toBe(true)
    expect(claimActive(adam, 10_000 + AGENT_CLAIM_TTL_MS)).toBe(false)
  })
})

describe('auto-follow', () => {
  it('follows the first agent that acts on a tile, and only when nobody is followed', () => {
    expect(useAgentPresence.getState().followAgentId).toBeNull()
    applyAgentCursorEvent(event({ seq: 1, kind: 'click' }), 1_000)
    expect(useAgentPresence.getState().followAgentId).toBe('adam')
    applyAgentCursorEvent(
      event({
        seq: 1,
        agentId: 'eve',
        name: 'Eve',
        kind: 'click',
        target: { tileId: 'tile-2', x: 0, y: 0 }
      }),
      2_000
    )
    expect(useAgentPresence.getState().followAgentId).toBe('adam')
  })

  it('does not start within 5 s of the user moving the camera', () => {
    noteUserCameraInteraction(10_000)
    applyAgentCursorEvent(event({ seq: 1, kind: 'click' }), 10_000 + AUTO_FOLLOW_USER_GRACE_MS - 1)
    expect(useAgentPresence.getState().followAgentId).toBeNull()
    applyAgentCursorEvent(event({ seq: 2, kind: 'click' }), 10_000 + AUTO_FOLLOW_USER_GRACE_MS)
    expect(useAgentPresence.getState().followAgentId).toBe('adam')
  })

  it('does not re-follow the same agent for 30 s after the user stopped following', () => {
    applyAgentCursorEvent(event({ seq: 1, kind: 'click' }), 1_000)
    stopFollowingByUser(2_000)
    expect(useAgentPresence.getState().followAgentId).toBeNull()
    applyAgentCursorEvent(event({ seq: 2, kind: 'click' }), 2_000 + AUTO_FOLLOW_SUPPRESS_MS - 1)
    expect(useAgentPresence.getState().followAgentId).toBeNull()
    applyAgentCursorEvent(event({ seq: 3, kind: 'click' }), 2_000 + AUTO_FOLLOW_SUPPRESS_MS)
    expect(useAgentPresence.getState().followAgentId).toBe('adam')
  })

  it('is disabled by the toggle and ignores non-tile actions', () => {
    setAutoFollowEnabled(false)
    applyAgentCursorEvent(event({ seq: 1, kind: 'click' }), 1_000)
    expect(useAgentPresence.getState().followAgentId).toBeNull()
    setAutoFollowEnabled(true)
    applyAgentCursorEvent(event({ seq: 2, kind: 'thinking', target: undefined }), 1_500)
    expect(useAgentPresence.getState().followAgentId).toBeNull()
    applyAgentCursorEvent(event({ seq: 3, kind: 'scroll' }), 2_000)
    expect(useAgentPresence.getState().followAgentId).toBe('adam')
  })

  it('keeps a web tile live for 10 s after the last action', () => {
    applyAgentCursorEvent(event({ seq: 1, kind: 'scroll' }), 50_000)
    expect(agentLiveOnTile('tile-1', 50_000 + AGENT_TILE_LIVE_MS - 1)).toBe(true)
    expect(agentLiveOnTile('tile-1', 50_000 + AGENT_TILE_LIVE_MS)).toBe(false)
    expect(agentLiveOnTile('tile-2', 50_000)).toBe(false)
  })
})

describe('hover and point targets', () => {
  it('a hover rect does not move the pointer', () => {
    applyAgentCursorEvent(event({ seq: 1, target: { tileId: 'tile-1', x: 50, y: 50 } }))
    applyAgentCursorEvent(
      event({ seq: 2, kind: 'hover', target: { tileId: 'tile-1', x: 0, y: 0, w: 100, h: 100 } })
    )
    const adam = useAgentPresence.getState().agents.adam
    expect(adam.pointer).toEqual({ tileId: 'tile-1', x: 50, y: 50 })
    expect(adam.hover).toEqual({ tileId: 'tile-1', x: 0, y: 0, w: 100, h: 100 })
    expect(adam.claimedTileId).toBe('tile-1')
  })

  it('a point with no size moves the pointer; a point with a size does not', () => {
    applyAgentCursorEvent(event({ seq: 1, target: { tileId: 'tile-1', x: 50, y: 50 } }))
    applyAgentCursorEvent(event({ seq: 2, kind: 'point', target: { tileId: 'tile-1', x: 7, y: 8 } }))
    expect(useAgentPresence.getState().agents.adam.pointer).toEqual({ tileId: 'tile-1', x: 7, y: 8 })
    applyAgentCursorEvent(
      event({ seq: 3, kind: 'point', target: { tileId: 'tile-1', x: 0, y: 0, w: 30, h: 30 } })
    )
    expect(useAgentPresence.getState().agents.adam.pointer).toEqual({ tileId: 'tile-1', x: 7, y: 8 })
  })
})
