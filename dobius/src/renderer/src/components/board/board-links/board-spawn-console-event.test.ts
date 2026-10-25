import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeBoardSpawnConsoleEvent } from '../../../../../shared/runtime-client-events'

const WT = 'wt-1'

type Card = Record<string, unknown> & { kind: string; role?: string | null }
const state = {
  boardsByWorktree: {} as Record<string, { cards: Card[]; viewport: { x: number; y: number; zoom: number } }>,
  tabsByWorktree: { [WT]: [{ id: 'tab-known' }] } as Record<string, { id: string }[]>,
  addCard: vi.fn((worktreeId: string, card: Card) => {
    const board = state.boardsByWorktree[worktreeId]
    board.cards.push({ ...card, id: `card-${board.cards.length + 1}` })
    return 'id'
  }),
  removeCards: vi.fn((worktreeId: string, ids: readonly string[]) => {
    const board = state.boardsByWorktree[worktreeId]
    board.cards = board.cards.filter((c) => !ids.includes(c.id as string))
  })
}

vi.mock('@/store', () => ({
  useAppStore: { getState: () => state, subscribe: vi.fn(() => () => undefined) }
}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: vi.fn() }))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), message: vi.fn() } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_k: string, fallback: string) => fallback }))
Object.assign(globalThis, {
  window: { api: { ui: { set: vi.fn(() => Promise.resolve()) } }, innerWidth: 1440, innerHeight: 900 }
})

const { launchAgentInNewTab } = await import('@/lib/launch-agent-in-new-tab')
const { closeTerminalTab } = await import('@/components/terminal/terminal-tab-actions')
const { toast } = await import('sonner')
const { handleBoardSpawnConsoleEvent, resetBoardSpawnConsoleHandlerForTest } =
  await import('./board-spawn-console-event')

const launch = vi.mocked(launchAgentInNewTab)

function workerCard(i: number, role: string | null): Card {
  return { id: `c${i}`, kind: 'console', tabId: `tab-${i}`, title: `W${i}`, agentKind: 'codex', role, x: 0, y: 0, w: 640, h: 400, z: i }
}

function event(over: Partial<RuntimeBoardSpawnConsoleEvent> = {}): RuntimeBoardSpawnConsoleEvent {
  return {
    type: 'boardSpawnConsole',
    requestId: 'req-1',
    worktreeId: WT,
    agent: 'codex',
    title: 'W1 · task-1',
    prompt: 'Do the thing',
    role: 'worker:lead-acme',
    leadId: 'lead-acme',
    taskId: 'task-1',
    ...over
  }
}

describe('handleBoardSpawnConsoleEvent', () => {
  beforeEach(() => {
    resetBoardSpawnConsoleHandlerForTest()
    launch.mockReset()
    state.addCard.mockClear()
    state.removeCards.mockClear()
    vi.mocked(closeTerminalTab).mockClear()
    vi.mocked(toast.error).mockClear()
    state.boardsByWorktree = { [WT]: { cards: [], viewport: { x: 0, y: 0, zoom: 1 } } }
    launch.mockImplementation(() => ({
      tabId: 'tab-new',
      startupPlan: {} as never,
      pasteDraftAfterLaunch: true
    }))
  })

  it('launches the agent with the prompt submitted after ready and adds one console card', () => {
    expect(handleBoardSpawnConsoleEvent(event({ commandOverride: 'codex --profile w' }))).toBe(
      'spawned'
    )
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0][0]).toMatchObject({
      agent: 'codex',
      worktreeId: WT,
      prompt: 'Do the thing',
      promptDelivery: 'submit-after-ready',
      agentCommandOverride: 'codex --profile w'
    })
    expect(state.addCard).toHaveBeenCalledTimes(1)
    const cards = state.boardsByWorktree[WT].cards
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      kind: 'console',
      tabId: 'tab-new',
      title: 'W1 · task-1',
      agentKind: 'codex',
      role: 'worker:lead-acme',
      w: 640,
      h: 400
    })
  })

  it('handles each requestId once', () => {
    expect(handleBoardSpawnConsoleEvent(event())).toBe('spawned')
    expect(handleBoardSpawnConsoleEvent(event())).toBe('duplicate')
    expect(handleBoardSpawnConsoleEvent(event({ requestId: 'req-2' }))).toBe('spawned')
    expect(launch).toHaveBeenCalledTimes(2)
    expect(state.boardsByWorktree[WT].cards).toHaveLength(2)
  })

  it('re-checks the worker caps against the live board', () => {
    state.boardsByWorktree[WT].cards = [0, 1, 2, 3].map((i) => workerCard(i, 'worker:lead-acme'))
    expect(handleBoardSpawnConsoleEvent(event())).toBe('refused')
    expect(launch).not.toHaveBeenCalled()

    state.boardsByWorktree[WT].cards = [
      ...[0, 1, 2].map((i) => workerCard(i, 'worker:lead-acme')),
      ...[3, 4, 5].map((i) => workerCard(i, 'worker:lead-b'))
    ]
    expect(handleBoardSpawnConsoleEvent(event({ requestId: 'req-2' }))).toBe('refused')
    expect(launch).not.toHaveBeenCalled()

    // Lead consoles never count, and a lead console is allowed at the cap.
    expect(
      handleBoardSpawnConsoleEvent(
        event({ requestId: 'req-3', role: 'lead:lead-acme', agent: 'codex', prompt: undefined })
      )
    ).toBe('spawned')
    expect(launch.mock.calls[0][0]).not.toHaveProperty('prompt')
  })

  it('refuses a non-TUI agent or a role outside the lead grammar', () => {
    expect(handleBoardSpawnConsoleEvent(event({ agent: 'bash' as never }))).toBe('refused')
    expect(handleBoardSpawnConsoleEvent(event({ requestId: 'req-2', role: 'review' }))).toBe(
      'refused'
    )
    expect(launch).not.toHaveBeenCalled()
    expect(state.addCard).not.toHaveBeenCalled()
  })

  it('reports a launch that produced no startup plan and adds no card', () => {
    launch.mockImplementation(() => null)
    expect(handleBoardSpawnConsoleEvent(event())).toBe('failed')
    expect(state.addCard).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('removes the stale cards main named, but only those with this role, before adding the new one', () => {
    state.boardsByWorktree[WT].cards = [
      { ...workerCard(1, 'lead:lead-acme'), id: 'dead-lead' },
      { ...workerCard(2, 'worker:lead-acme'), id: 'live-worker' },
      { ...workerCard(3, 'lead:lead-b'), id: 'other-lead' }
    ]
    expect(
      handleBoardSpawnConsoleEvent(
        event({
          role: 'lead:lead-acme',
          prompt: undefined,
          replaceStaleCardIds: ['dead-lead', 'live-worker', 'other-lead', 'nope']
        })
      )
    ).toBe('spawned')
    expect(state.removeCards).toHaveBeenCalledWith(WT, ['dead-lead'])
    expect(closeTerminalTab).toHaveBeenCalledTimes(1)
    expect(closeTerminalTab).toHaveBeenCalledWith('tab-1')
    const ids = state.boardsByWorktree[WT].cards.map((c) => c.id)
    expect(ids).not.toContain('dead-lead')
    expect(ids).toContain('live-worker')
    expect(ids).toContain('other-lead')
    expect(
      state.boardsByWorktree[WT].cards.filter((c) => c.role === 'lead:lead-acme')
    ).toHaveLength(1)
  })

  it('binds a host-backed launch (no tabId) to the card once its tab mirrors in', () => {
    launch.mockImplementation(() => ({
      tabId: null,
      startupPlan: {} as never,
      pasteDraftAfterLaunch: false
    }))
    state.tabsByWorktree[WT] = [{ id: 'tab-known' }]
    expect(handleBoardSpawnConsoleEvent(event())).toBe('pending-mirror')
    expect(state.addCard).not.toHaveBeenCalled()
  })
})
