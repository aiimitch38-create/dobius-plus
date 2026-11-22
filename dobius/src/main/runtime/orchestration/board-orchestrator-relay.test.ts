import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const admission = vi.hoisted(() => ({ allowed: true }))
vi.mock('../../agents/execution-gate', () => ({
  checkExecutionAdmission: () =>
    admission.allowed ? { allowed: true } : { allowed: false, reason: 'paused', message: 'paused' }
}))
import type { DobiusRuntimeService } from '../dobius-runtime'
import { RpcDispatcher } from '../rpc/dispatcher'
import { ORCHESTRATION_METHODS } from '../rpc/methods/orchestration'
import { OrchestrationDb } from './db'
import { findBoardOrchestrator, relayToBoardOrchestrator } from './board-orchestrator-relay'

const WT = 'wt-1'
const consoleCard = (n: number, title = `Builder ${n}`) => ({
  id: `c${n}`,
  kind: 'console',
  tabId: `tab-${n}`,
  title
})
const orchestrator = (wired: string[], extra: Record<string, unknown> = {}) => ({
  id: 'orch-1',
  kind: 'orchestrator',
  name: 'Team',
  wiredCardIds: wired,
  ...extra
})
type T = {
  handle: string
  tabId: string
  ptyId: string | null
  connected: boolean
  leafId?: string
  originTabId?: string | null
}
const live = (n: number): T => ({
  handle: `term_${n}`,
  tabId: `tab-${n}`,
  ptyId: `pty-${n}`,
  connected: true
})
type AgentStatus = { isRunningAgent: boolean; status: string | null }

let db: OrchestrationDb | null = null
afterEach(() => {
  db?.close()
  db = null
})

beforeEach(() => {
  admission.allowed = true
})

function makeRuntime(
  cards: unknown[],
  terminals: T[],
  opts: {
    status?: (handle: string, call: number) => AgentStatus
    activeLeafByTab?: Record<string, string>
    cursorHandles?: string[]
  } = {}
) {
  db = new OrchestrationDb(':memory:')
  const orchestrationDb = db
  const calls = new Map<string, number>()
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    getUIState: () => ({ boardsByWorktree: { [WT]: { cards, groups: [] } } }),
    listTerminals: vi.fn(async () => ({ terminals, totalCount: terminals.length, truncated: false })),
    getTerminalTabActiveLeafId: (tabId: string) => opts.activeLeafByTab?.[tabId] ?? null,
    getTerminalAgentStatus: vi.fn(async (handle: string) => {
      const n = (calls.get(handle) ?? 0) + 1
      calls.set(handle, n)
      return { handle, ...(opts.status?.(handle, n) ?? { isRunningAgent: true, status: 'idle' }) }
    }),
    isCursorAgentTerminal: (handle: string) => opts.cursorHandles?.includes(handle) ?? false,
    // What the runtime's push-on-idle would see while this send is in flight.
    undeliveredDuringSend: [] as number[],
    // Mirrors writeTerminalAction: beforeWrite before the text, then again before Enter.
    sendTerminal: vi.fn(
      async (
        handle: string,
        action: { text?: string; enter?: boolean },
        options: { beforeWrite?: (ptyId: string) => void | Promise<void> } = {}
      ) => {
        runtime.undeliveredDuringSend.push(
          orchestrationDb.getUndeliveredUnreadMessages(handle).length
        )
        await options.beforeWrite?.('pty')
        if (action.enter) {
          await options.beforeWrite?.('pty')
        }
        return { handle, accepted: true, bytesWritten: 1 }
      }
    ),
    getOrchestrationDb: () => orchestrationDb,
    notifyMessageArrived: vi.fn()
  }
  return runtime
}

const asRuntime = (r: ReturnType<typeof makeRuntime>) => r as unknown as DobiusRuntimeService

describe('relayToBoardOrchestrator', () => {
  it('fans out to exactly the wired consoles, from the card mailbox, one thread', async () => {
    const runtime = makeRuntime(
      [consoleCard(1), consoleCard(2), consoleCard(3), orchestrator(['c1', 'c3'])],
      [live(1), live(2), live(3)]
    )
    const result = await relayToBoardOrchestrator(
      asRuntime(runtime),
      { to: 'board:orch-1', subject: 'ignored', body: 'run the tests\nthen lint' },
      () => 42
    )
    expect(result.recipients).toBe(2)
    expect(result.messages.map((m) => m.to_handle).sort()).toEqual(['term_1', 'term_3'])
    for (const m of result.messages) {
      expect(m.from_handle).toBe('board-orchestrator:orch-1')
      expect(m.subject).toBe('run the tests')
      expect(m.body).toBe('run the tests\nthen lint')
      expect(m.thread_id).toBe('board_orch-1_42')
    }
    expect(runtime.listTerminals).toHaveBeenCalledWith(`id:${WT}`, expect.any(Number))
    expect(runtime.sendTerminal).toHaveBeenCalledTimes(2)
    expect(runtime.sendTerminal).toHaveBeenCalledWith(
      'term_1',
      { text: expect.stringContaining('run the tests'), enter: true },
      expect.objectContaining({ beforeWrite: expect.any(Function) })
    )
    expect(runtime.notifyMessageArrived).toHaveBeenCalledWith('term_1', 'status')
    // Why: stamped delivered so the unguarded push-on-idle never types it again.
    expect(db?.getUndeliveredUnreadMessages('term_1')).toEqual([])
  })

  it('sends "@Name rest" to that one wired console only', async () => {
    const runtime = makeRuntime(
      [consoleCard(1), consoleCard(2), orchestrator(['c1', 'c2'])],
      [live(1), live(2)]
    )
    const result = await relayToBoardOrchestrator(asRuntime(runtime), {
      to: 'board:orch-1',
      subject: '@Builder 2 fix the build'
    })
    expect(result.messages.map((m) => [m.to_handle, m.body])).toEqual([['term_2', 'fix the build']])
  })

  it('refuses an @mention of a console that is not wired, sending nothing', async () => {
    const runtime = makeRuntime([consoleCard(1), consoleCard(2), orchestrator(['c1'])], [live(1), live(2)])
    await expect(
      relayToBoardOrchestrator(asRuntime(runtime), { to: 'board:orch-1', subject: '@Builder 2 hi' })
    ).rejects.toMatchObject({ code: 'board_orchestrator_refused' })
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
  })

  it('fails with board_orchestrator_none_running when no wired console has a terminal', async () => {
    const runtime = makeRuntime([consoleCard(1), orchestrator(['c1'])], [live(2)])
    await expect(
      relayToBoardOrchestrator(asRuntime(runtime), { to: 'board:orch-1', subject: 'hi' })
    ).rejects.toMatchObject({ code: 'board_orchestrator_none_running' })
  })

  it('fails with board_orchestrator_not_found for an unknown card, never a fallback', async () => {
    const runtime = makeRuntime([consoleCard(1), orchestrator(['c1'])], [live(1)])
    await expect(
      relayToBoardOrchestrator(asRuntime(runtime), { to: 'board:nope', subject: 'hi' })
    ).rejects.toMatchObject({ code: 'board_orchestrator_not_found' })
    expect(runtime.listTerminals).not.toHaveBeenCalled()
  })

  it('refuses lifecycle message types', async () => {
    const runtime = makeRuntime([consoleCard(1), orchestrator(['c1'])], [live(1)])
    await expect(
      relayToBoardOrchestrator(asRuntime(runtime), {
        to: 'board:orch-1',
        subject: 'done',
        type: 'worker_done'
      })
    ).rejects.toThrow('worker_done messages must be sent to a concrete coordinator')
  })
})

describe('relayToBoardOrchestrator guarded delivery', () => {
  it('refuses everything while the crew is paused, before inserting or typing', async () => {
    admission.allowed = false
    const runtime = makeRuntime([consoleCard(1), orchestrator(['c1'])], [live(1)])
    await expect(
      relayToBoardOrchestrator(asRuntime(runtime), { to: 'board:orch-1', subject: 'hi' })
    ).rejects.toMatchObject({ code: 'board_orchestrator_paused' })
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
    expect(db?.getUnreadMessages('term_1') ?? []).toEqual([])
  })

  it('rechecks before Enter: a permission prompt that appears mid-send stops that console only', async () => {
    const runtime = makeRuntime(
      [consoleCard(1), consoleCard(2), orchestrator(['c1', 'c2'])],
      [live(1), live(2)],
      {
        // call 1 = pre-check, 2 = before text, 3 = before Enter
        status: (handle, call) =>
          handle === 'term_1' && call === 3
            ? { isRunningAgent: true, status: 'permission' }
            : { isRunningAgent: true, status: 'idle' }
      }
    )
    const result = await relayToBoardOrchestrator(asRuntime(runtime), {
      to: 'board:orch-1',
      subject: 'hi'
    })
    expect(result.recipients).toBe(1)
    expect(result.messages.map((m) => m.to_handle)).toEqual(['term_2'])
    expect(result.refused).toEqual([
      expect.objectContaining({ handle: 'term_1', reason: 'permission', partlyTyped: true })
    ])
    expect(db?.getUndeliveredUnreadMessages('term_1')).toEqual([])
  })

  it('never types into a console with no agent; all refused is an error', async () => {
    const runtime = makeRuntime([consoleCard(1), orchestrator(['c1'])], [live(1)], {
      status: () => ({ isRunningAgent: false, status: null })
    })
    await expect(
      relayToBoardOrchestrator(asRuntime(runtime), { to: 'board:orch-1', subject: 'hi' })
    ).rejects.toMatchObject({ code: 'board_orchestrator_not_delivered' })
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
  })

  it('stops at the next write when the crew is paused mid-send', async () => {
    const runtime = makeRuntime([consoleCard(1), orchestrator(['c1'])], [live(1)], {
      status: (_h, call) => {
        if (call === 3) {
          admission.allowed = false
        }
        return { isRunningAgent: true, status: 'idle' }
      }
    })
    await expect(
      relayToBoardOrchestrator(asRuntime(runtime), { to: 'board:orch-1', subject: 'hi' })
    ).rejects.toThrow('the crew is paused; text may be partly typed, Enter was not pressed')
  })
})

describe('relay and the runtime push-on-idle', () => {
  it('excludes the stored row from automatic delivery before the guarded send starts', async () => {
    const runtime = makeRuntime([consoleCard(1), orchestrator(['c1'])], [live(1)])
    await relayToBoardOrchestrator(asRuntime(runtime), { to: 'board:orch-1', subject: 'hi' })
    // Why: during the 500 ms settle an idle push would otherwise re-type it with an unguarded Enter.
    expect(runtime.undeliveredDuringSend).toEqual([0])
  })

  it('types into a Cursor Agent console without pressing Enter', async () => {
    const runtime = makeRuntime(
      [consoleCard(1), consoleCard(2), orchestrator(['c1', 'c2'])],
      [live(1), live(2)],
      { cursorHandles: ['term_1'] }
    )
    const result = await relayToBoardOrchestrator(asRuntime(runtime), {
      to: 'board:orch-1',
      subject: 'hi'
    })
    expect(runtime.sendTerminal).toHaveBeenCalledWith(
      'term_1',
      expect.objectContaining({ enter: false }),
      expect.anything()
    )
    expect(runtime.sendTerminal).toHaveBeenCalledWith(
      'term_2',
      expect.objectContaining({ enter: true }),
      expect.anything()
    )
    expect(result.typedNotSubmitted).toEqual([
      { cardId: 'c1', title: 'Builder 1', handle: 'term_1' }
    ])
  })
})

describe('relay recipients (one live pane per wired console)', () => {
  it('sends a split console the message once, in its focused pane', async () => {
    const runtime = makeRuntime(
      [consoleCard(1), orchestrator(['c1'])],
      [
        { handle: 'term_l', tabId: 'tab-1', leafId: 'l', ptyId: 'p1', connected: true },
        { handle: 'term_r', tabId: 'tab-1', leafId: 'r', ptyId: 'p2', connected: true }
      ],
      { activeLeafByTab: { 'tab-1': 'r' } }
    )
    const result = await relayToBoardOrchestrator(asRuntime(runtime), {
      to: 'board:orch-1',
      subject: 'hi'
    })
    expect(result.messages.map((m) => m.to_handle)).toEqual(['term_r'])
  })

  it('skips a split console with no focused pane instead of typing into both', async () => {
    const runtime = makeRuntime(
      [consoleCard(1), consoleCard(2), orchestrator(['c1', 'c2'])],
      [
        { handle: 'term_l', tabId: 'tab-1', leafId: 'l', ptyId: 'p1', connected: true },
        { handle: 'term_r', tabId: 'tab-1', leafId: 'r', ptyId: 'p2', connected: true },
        live(2)
      ]
    )
    const result = await relayToBoardOrchestrator(asRuntime(runtime), {
      to: 'board:orch-1',
      subject: 'hi'
    })
    expect(result.messages.map((m) => m.to_handle)).toEqual(['term_2'])
    expect(result.skipped).toEqual([{ cardId: 'c1', title: 'Builder 1', reason: 'pane-unclear' }])
  })

  it('does not count an exited terminal as delivered', async () => {
    const runtime = makeRuntime(
      [consoleCard(1), consoleCard(2), orchestrator(['c1', 'c2'])],
      [{ handle: 'term_dead', tabId: 'tab-1', ptyId: null, connected: false }, live(2)]
    )
    const result = await relayToBoardOrchestrator(asRuntime(runtime), {
      to: 'board:orch-1',
      subject: 'hi'
    })
    expect(result.recipients).toBe(1)
    expect(result.skipped).toEqual([{ cardId: 'c1', title: 'Builder 1', reason: 'not-running' }])
  })

  it('reaches a console listed from its PTY record through originTabId', async () => {
    const runtime = makeRuntime(
      [consoleCard(1), orchestrator(['c1'])],
      [{ handle: 'term_pty', tabId: 'pty:p1', originTabId: 'tab-1', ptyId: 'p1', connected: true }]
    )
    const result = await relayToBoardOrchestrator(asRuntime(runtime), {
      to: 'board:orch-1',
      subject: 'hi'
    })
    expect(result.messages.map((m) => m.to_handle)).toEqual(['term_pty'])
  })

  it('sends once when two wired cards resolve to the same terminal', async () => {
    const runtime = makeRuntime(
      [consoleCard(1), { ...consoleCard(2), tabId: 'tab-1' }, orchestrator(['c1', 'c2'])],
      [live(1)]
    )
    const result = await relayToBoardOrchestrator(asRuntime(runtime), {
      to: 'board:orch-1',
      subject: 'hi'
    })
    expect(result.messages.map((m) => m.to_handle)).toEqual(['term_1'])
  })

  it('refuses an @mention two wired consoles answer to', async () => {
    const runtime = makeRuntime(
      [consoleCard(1, 'Builder'), consoleCard(2, 'builder'), orchestrator(['c1', 'c2'])],
      [live(1), live(2)]
    )
    await expect(
      relayToBoardOrchestrator(asRuntime(runtime), { to: 'board:orch-1', subject: '@Builder go' })
    ).rejects.toMatchObject({ code: 'board_orchestrator_refused' })
    expect(runtime.sendTerminal).not.toHaveBeenCalled()
  })
})

describe('findBoardOrchestrator', () => {
  const boards = {
    a: { cards: [orchestrator([], { id: 'o1', name: 'Team' })] },
    b: { cards: [orchestrator([], { id: 'o2', name: 'team' }), orchestrator([], { id: 'o3', name: 'Ops' })] }
  }
  it('matches a card id, then an exact name, then a case-insensitive name', () => {
    expect(findBoardOrchestrator(boards, 'o2').worktreeId).toBe('b')
    expect(findBoardOrchestrator(boards, 'Team').cardId).toBe('o1')
    expect(findBoardOrchestrator(boards, 'ops').cardId).toBe('o3')
  })
  it('refuses an ambiguous name', () => {
    const twin = { a: boards.a, c: { cards: [orchestrator([], { id: 'o9', name: 'Team' })] } }
    expect(() => findBoardOrchestrator(twin, 'Team')).toThrow('board_orchestrator_ambiguous')
  })
})

describe('orchestration.send --to board:', () => {
  it('relays through the RPC and reports structured errors', async () => {
    const runtime = makeRuntime([consoleCard(1), orchestrator(['c1'])], [live(1)])
    const dispatcher = new RpcDispatcher({ runtime: asRuntime(runtime), methods: ORCHESTRATION_METHODS })
    const ok = await dispatcher.dispatch({
      id: 'r1',
      authToken: 'tok',
      method: 'orchestration.send',
      params: { to: 'board:orch-1', subject: 'hello team' }
    })
    expect(ok).toMatchObject({ ok: true, result: { recipients: 1 } })
    const missing = await dispatcher.dispatch({
      id: 'r2',
      authToken: 'tok',
      method: 'orchestration.send',
      params: { to: 'board:gone', subject: 'hello' }
    })
    expect(missing).toMatchObject({ ok: false, error: { code: 'board_orchestrator_not_found' } })
  })
})
