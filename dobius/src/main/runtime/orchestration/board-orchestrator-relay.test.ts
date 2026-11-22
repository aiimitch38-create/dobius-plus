import { afterEach, describe, expect, it, vi } from 'vitest'
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
const live = (n: number) => ({
  handle: `term_${n}`,
  tabId: `tab-${n}`,
  ptyId: `pty-${n}`,
  connected: true
})

let db: OrchestrationDb | null = null
afterEach(() => {
  db?.close()
  db = null
})

function makeRuntime(cards: unknown[], terminals: { handle: string; tabId: string }[]) {
  db = new OrchestrationDb(':memory:')
  const orchestrationDb = db
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    getUIState: () => ({ boardsByWorktree: { [WT]: { cards, groups: [] } } }),
    listTerminals: vi.fn(async () => ({ terminals, totalCount: terminals.length, truncated: false })),
    getOrchestrationDb: () => orchestrationDb,
    deliverPendingMessagesForHandle: vi.fn(),
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
    expect(runtime.deliverPendingMessagesForHandle).toHaveBeenCalledTimes(2)
    expect(runtime.notifyMessageArrived).toHaveBeenCalledWith('term_1', 'status')
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
    expect(runtime.deliverPendingMessagesForHandle).not.toHaveBeenCalled()
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
