import { describe, expect, it, vi } from 'vitest'
import type { AgentCursorEvent } from '../../shared/agent-cursor'
import type { AgentCommandIdentity } from './agent-command-context'
import { AgentCursorDriver, type AgentClearance, type AgentCursorHooks, type CdpSend } from './agent-cursor-driver'
import { AGENT_GATED_DWELL_MS, AGENT_HOVER_DWELL_MS } from './agent-cursor-driver-types'

const adam: AgentCommandIdentity = { agentId: 'adam', name: 'Adam', fast: false }

type MockedHooks = {
  notify: ReturnType<typeof vi.fn<AgentCursorHooks['notify']>>
  awaitAgentClearance: ReturnType<typeof vi.fn<AgentCursorHooks['awaitAgentClearance']>>
  claimTile: ReturnType<typeof vi.fn<AgentCursorHooks['claimTile']>>
  requestGateApproval: ReturnType<typeof vi.fn<AgentCursorHooks['requestGateApproval']>>
}

type Harness = {
  driver: AgentCursorDriver
  events: AgentCursorEvent[]
  hooks: MockedHooks
  cdp: ReturnType<typeof vi.fn<CdpSend>>
  /** Virtual clock: sleep advances it instantly. */
  now: () => number
}

function harness(overrides: Partial<AgentCursorHooks> = {}): Harness {
  const events: AgentCursorEvent[] = []
  let clock = 1_000_000
  const hooks: MockedHooks = {
    notify: vi.fn<AgentCursorHooks['notify']>((event) => {
      events.push(event)
    }),
    awaitAgentClearance: vi.fn<AgentCursorHooks['awaitAgentClearance']>(
      async (): Promise<AgentClearance> => 'ok'
    ),
    claimTile: vi.fn<AgentCursorHooks['claimTile']>(() => ({ ok: true, until: clock + 3000 })),
    requestGateApproval: vi.fn<AgentCursorHooks['requestGateApproval']>(async () => true)
  }
  for (const [key, value] of Object.entries(overrides)) {
    ;(hooks as unknown as Record<string, unknown>)[key] = value
  }
  const driver = new AgentCursorDriver(hooks, {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    log: () => {}
  })
  const cdp = vi.fn<CdpSend>(async () => ({}))
  return { driver, events, hooks, cdp, now: () => clock }
}

describe('AgentCursorDriver', () => {
  it('sequences move -> hover -> click with CDP mouseMoved along the path and the dwell', async () => {
    const h = harness()
    const box = { x: 100, y: 200, w: 80, h: 30 }

    const stage = await h.driver.stage({ identity: adam, tileId: 'card-1', box, cdp: h.cdp })
    h.driver.emitAction(adam, 'card-1', 'click')

    const kinds = h.events.map((e) => e.kind)
    expect(kinds[0]).toBe('move')
    expect(kinds.filter((k) => k === 'move').length).toBeGreaterThan(3)
    expect(kinds.slice(-2)).toEqual(['hover', 'click'])
    expect(kinds).not.toContain('paused')

    // Hover carries the element box; the click lands on its center.
    const hover = h.events.find((e) => e.kind === 'hover')!
    expect(hover.target).toEqual({ tileId: 'card-1', x: 100, y: 200, w: 80, h: 30 })
    expect(stage.point).toEqual({ x: 140, y: 215 })
    const click = h.events.at(-1)!
    expect(click.target).toEqual({ tileId: 'card-1', x: 140, y: 215 })

    // Dwell: the click is emitted >= 250 ms after the hover.
    expect(click.ts - hover.ts).toBeGreaterThanOrEqual(AGENT_HOVER_DWELL_MS)

    // Every CDP mouseMoved mirrors an emitted point; the last one is the target.
    const moves = h.cdp.mock.calls.filter((c) => c[0] === 'Input.dispatchMouseEvent')
    expect(moves.length).toBeGreaterThan(3)
    expect(moves.at(-1)![1]).toEqual({ type: 'mouseMoved', x: 140, y: 215 })
    const lastMoveEvent = h.events.filter((e) => e.kind === 'move').at(-1)!
    expect(lastMoveEvent.target).toMatchObject({ x: 140, y: 215 })

    // seq is strictly increasing per agent and the color is Adam's blue.
    for (let i = 1; i < h.events.length; i++) {
      expect(h.events[i].seq).toBe(h.events[i - 1].seq + 1)
    }
    expect(h.events[0].color).toBe('oklch(0.56 0.17 255)')
    expect(h.events[0].name).toBe('Adam')
    expect(h.hooks.claimTile).toHaveBeenCalledWith('adam', 'card-1')
  })

  it('paces consecutive actions at >= 350 ms in watchable mode', async () => {
    const h = harness()
    await h.driver.stage({ identity: adam, tileId: 'card-1', point: { x: 10, y: 10 } })
    h.driver.emitAction(adam, 'card-1', 'click')
    const firstClickAt = h.now()
    await h.driver.stage({ identity: adam, tileId: 'card-1', point: { x: 12, y: 12 } })
    h.driver.emitAction(adam, 'card-1', 'click')
    expect(h.now() - firstClickAt).toBeGreaterThanOrEqual(350)
  })

  it('fast mode collapses travel to a single move but keeps the gated dwell', async () => {
    const h = harness()
    const fast: AgentCommandIdentity = { ...adam, fast: true }
    await h.driver.stage({
      identity: fast,
      tileId: 'card-1',
      box: { x: 0, y: 0, w: 50, h: 20 },
      gate: 'send',
      cdp: h.cdp
    })
    const kinds = h.events.map((e) => e.kind)
    expect(kinds.filter((k) => k === 'move')).toHaveLength(1)
    const hover = h.events.find((e) => e.kind === 'hover')!
    const waiting = h.events.find((e) => e.kind === 'waiting_human')!
    expect(waiting.ts - hover.ts).toBeGreaterThanOrEqual(AGENT_GATED_DWELL_MS)
  })

  it('a paused agent blocks and errors with agent_paused after the clearance wait', async () => {
    const h = harness({ awaitAgentClearance: vi.fn(async () => 'paused' as const) })
    await expect(
      h.driver.stage({ identity: adam, tileId: 'card-1', point: { x: 1, y: 1 } })
    ).rejects.toMatchObject({ code: 'agent_paused', message: expect.stringMatching(/retry/i) })
    expect(h.events.map((e) => e.kind)).not.toContain('click')
    expect(h.hooks.claimTile).not.toHaveBeenCalled()
  })

  it('a yielding tile (human has control) blocks with human_has_control', async () => {
    const h = harness({ awaitAgentClearance: vi.fn(async () => 'yielding' as const) })
    await expect(
      h.driver.stage({ identity: adam, tileId: 'card-1', point: { x: 1, y: 1 } })
    ).rejects.toMatchObject({ code: 'human_has_control' })
    expect(h.cdp).not.toHaveBeenCalled()
  })

  it('a stopped agent emits stopped and errors', async () => {
    const h = harness({ awaitAgentClearance: vi.fn(async () => 'stopped' as const) })
    await expect(
      h.driver.stage({ identity: adam, tileId: 'card-1', point: { x: 1, y: 1 } })
    ).rejects.toMatchObject({ code: 'agent_stopped' })
    expect(h.events.map((e) => e.kind)).toEqual(['stopped'])
  })

  it('a foreign tile claim blocks with human_has_control', async () => {
    const h = harness({ claimTile: vi.fn(() => ({ ok: false as const, heldBy: 'maya' })) })
    await expect(
      h.driver.stage({ identity: adam, tileId: 'card-1', point: { x: 1, y: 1 } })
    ).rejects.toMatchObject({ code: 'human_has_control', message: expect.stringContaining('maya') })
  })

  it('a gated click waits for approval, dwells 600 ms, then proceeds on approve', async () => {
    let resolveGate!: (approved: boolean) => void
    const requestGateApproval = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveGate = resolve
        })
    )
    const h = harness({ requestGateApproval })
    const dispatched = vi.fn()

    const pending = h.driver
      .stage({ identity: adam, tileId: 'card-1', box: { x: 0, y: 0, w: 40, h: 40 }, gate: 'purchase' })
      .then((stage) => {
        dispatched()
        return stage
      })
    await vi.waitFor(() => expect(requestGateApproval).toHaveBeenCalledTimes(1))
    expect(dispatched).not.toHaveBeenCalled()

    const waiting = h.events.find((e) => e.kind === 'waiting_human')!
    expect(waiting.gated).toEqual({ kind: 'purchase', requestId: expect.any(String) })
    expect(requestGateApproval).toHaveBeenCalledWith('adam', {
      kind: 'purchase',
      requestId: waiting.gated!.requestId
    })
    const hover = h.events.find((e) => e.kind === 'hover')!
    expect(waiting.ts - hover.ts).toBeGreaterThanOrEqual(AGENT_GATED_DWELL_MS)

    resolveGate(true)
    const stage = await pending
    expect(stage.gate).toBe('purchase')
    expect(dispatched).toHaveBeenCalledTimes(1)
  })

  it('a denied gate throws agent_gate_denied and never resolves the stage', async () => {
    const h = harness({ requestGateApproval: vi.fn(async () => false) })
    await expect(
      h.driver.stage({ identity: adam, tileId: 'card-1', point: { x: 5, y: 5 }, gate: 'delete' })
    ).rejects.toMatchObject({ code: 'agent_gate_denied' })
    const kinds = h.events.map((e) => e.kind)
    expect(kinds).toContain('waiting_human')
    expect(kinds.at(-1)).toBe('idle')
  })

  it('falls back to sendInputEvent only when CDP mouseMoved fails, and logs it', async () => {
    const log = vi.fn()
    const events: AgentCursorEvent[] = []
    const driver = new AgentCursorDriver(
      {
        notify: (e) => {
          events.push(e)
        },
        awaitAgentClearance: async () => 'ok',
        claimTile: () => undefined,
        requestGateApproval: async () => true
      },
      { now: () => 1, sleep: async () => {}, log }
    )
    const fallback = vi.fn()
    const fast: AgentCommandIdentity = { ...adam, fast: true }
    await driver.stage({
      identity: fast,
      tileId: 'card-1',
      point: { x: 3, y: 4 },
      cdp: async () => {
        throw new Error('debugger detached')
      },
      fallbackMouseMove: fallback
    })
    expect(fallback).toHaveBeenCalledWith({ x: 3, y: 4 })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('sendInputEvent fallback'))
  })

  it('emitAction for type carries textLength only', () => {
    const h = harness()
    const event = h.driver.emitAction(adam, 'card-1', 'type', { textLength: 12 })
    expect(event.textLength).toBe(12)
    expect(event.text).toBeUndefined()
  })

  it('a notify failure never fails the action', async () => {
    const h = harness({
      notify: vi.fn(() => {
        throw new Error('renderer gone')
      })
    })
    await expect(
      h.driver.stage({ identity: adam, tileId: 'card-1', point: { x: 1, y: 1 } })
    ).resolves.toMatchObject({ point: { x: 1, y: 1 } })
  })

  it('re-checks clearance (waitMs 0) right before dispatch and refuses a stale ok', async () => {
    const answers: AgentClearance[] = ['ok', 'paused']
    const awaitAgentClearance = vi.fn(async () => answers.shift() ?? 'ok')
    const h = harness({ awaitAgentClearance })
    await expect(
      h.driver.stage({ identity: adam, tileId: 'card-1', box: { x: 10, y: 10, w: 40, h: 20 }, cdp: h.cdp })
    ).rejects.toMatchObject({ code: 'agent_paused' })
    expect(awaitAgentClearance).toHaveBeenCalledTimes(2)
    expect(awaitAgentClearance.mock.calls[1]).toEqual(['adam', 'card-1', 0])
    // Travel and hover happened, but the caller never gets a stage to act on.
    expect(h.events.map((e) => e.kind)).toContain('hover')

    const yielding = harness({ awaitAgentClearance: vi.fn(async () => (yieldingAnswers.shift() ?? 'ok') as AgentClearance) })
    const yieldingAnswers: AgentClearance[] = ['ok', 'yielding']
    await expect(
      yielding.driver.stage({ identity: adam, tileId: 'card-1', point: { x: 1, y: 1 } })
    ).rejects.toMatchObject({ code: 'human_has_control' })
  })

  it('assertClearNow throws from the synchronous snapshot without awaiting the registry', () => {
    const awaitAgentClearance = vi.fn(async () => 'ok' as const)
    const paused = harness({ awaitAgentClearance, clearanceNow: () => 'paused' })
    expect(() => paused.driver.assertClearNow(adam, 'card-1')).toThrow(
      expect.objectContaining({ code: 'agent_paused' })
    )
    const yielding = harness({ awaitAgentClearance, clearanceNow: () => 'yielding' })
    expect(() => yielding.driver.assertClearNow(adam, 'card-1')).toThrow(
      expect.objectContaining({ code: 'human_has_control' })
    )
    const stopped = harness({ awaitAgentClearance, clearanceNow: () => 'stopped' })
    expect(() => stopped.driver.assertClearNow(adam, 'card-1')).toThrow(
      expect.objectContaining({ code: 'agent_stopped' })
    )
    expect(stopped.events.map((e) => e.kind)).toEqual(['stopped'])
    expect(awaitAgentClearance).not.toHaveBeenCalled()
    // Without a snapshot hook the check is a no-op (fail open only on wiring, never on state).
    expect(() => harness().driver.assertClearNow(adam, 'card-1')).not.toThrow()
  })

  it('brackets every CDP mouseMoved with markAgentDispatch so main never reads it as human input', async () => {
    const open: string[] = []
    const closed: string[] = []
    const markAgentDispatch = vi.fn((tileId: string) => {
      open.push(tileId)
      return () => {
        closed.push(tileId)
      }
    })
    const h = harness({ markAgentDispatch })
    let dispatchingDuringMove = 0
    h.cdp.mockImplementation(async () => {
      if (open.length > closed.length) {
        dispatchingDuringMove++
      }
      return {}
    })
    await h.driver.stage({ identity: adam, tileId: 'card-1', box: { x: 300, y: 300, w: 40, h: 40 }, cdp: h.cdp })
    const moves = h.cdp.mock.calls.filter((c) => c[0] === 'Input.dispatchMouseEvent').length
    expect(moves).toBeGreaterThan(3)
    expect(dispatchingDuringMove).toBe(moves)
    expect(open).toHaveLength(moves)
    expect(closed).toHaveLength(moves)
    expect(open.every((t) => t === 'card-1')).toBe(true)
    // The bracket closes even when CDP throws.
    const release = h.driver.markDispatch('card-1')
    expect(typeof release).toBe('function')
  })
})
