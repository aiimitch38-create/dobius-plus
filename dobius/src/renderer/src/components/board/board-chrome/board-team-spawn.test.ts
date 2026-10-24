import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnConsoles = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()
const groupBoardCards = vi.fn()
const createGroup = vi.fn()

type Listener = (state: StoreState, prev: StoreState) => void
type StoreState = {
  tabsByWorktree: Record<string, { id: string }[]>
  boardsByWorktree: Record<string, unknown>
  createGroup: typeof createGroup
}
let storeState: StoreState
const listeners = new Set<Listener>()
const setStore = (next: Partial<StoreState>): void => {
  const prev = storeState
  storeState = { ...storeState, ...next }
  for (const l of listeners) {
    l(storeState, prev)
  }
}
let boardCards: { id: string; kind: string; tabId: string; title: string; agentKind: string }[]

vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string | number>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values?.[k] ?? ''))
}))
vi.mock('@/lib/agent-catalog', () => ({ getAgentLabel: (a: string) => `L:${a}` }))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => storeState,
    subscribe: (l: Listener) => {
      listeners.add(l)
      return () => listeners.delete(l)
    }
  }
}))
vi.mock('@/store/slices/board', () => ({ getBoard: () => ({ cards: boardCards, groups: [] }) }))
vi.mock('../board-canvas/board-spawn-placement', () => ({
  BOARD_CONSOLE_SIZE: { w: 10, h: 10 },
  boardSpawnPlacements: (_c: unknown, n: number) =>
    Array.from({ length: n }, (_, i) => ({ x: i * 20, y: 0 }))
}))
vi.mock('../board-delivery/console-lifecycle', () => ({ spawnConsoles }))
vi.mock('../board-route/board-groupable', () => ({
  groupBoardCards,
  groupableCardIds: (_cards: unknown, ids: Set<string>) => [...ids]
}))

const { spawnTeamOnBoard, EARLY_EXIT_WINDOW_MS } = await import('./board-team-spawn')

const slots = [
  { role: 'general' as const, agent: 'codex' as const },
  { role: 'general' as const, agent: 'codex' as const },
  { role: 'general' as const, agent: 'codex' as const }
]

beforeEach(() => {
  vi.clearAllMocks()
  listeners.clear()
  boardCards = []
  storeState = { tabsByWorktree: { wt: [] }, boardsByWorktree: {}, createGroup }
})

describe('spawnTeamOnBoard never fails silently', () => {
  it('toasts the reason when every launch throws, and returns no cards', () => {
    spawnConsoles.mockImplementation(() => {
      throw new Error('createTab exploded')
    })
    expect(spawnTeamOnBoard('wt', slots, { x: 0, y: 0 }, 'Frontend squad')).toEqual([])
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError.mock.calls[0][0]).toBe('The team did not start: createTab exploded')
    expect(toastError.mock.calls[0][1]).toEqual({ duration: 12_000 })
    expect(createGroup).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('names the agent when its launch plan cannot be built', () => {
    spawnConsoles.mockReturnValue({ cardIds: [], failed: 1 })
    expect(spawnTeamOnBoard('wt', slots, { x: 0, y: 0 })).toEqual([])
    expect(toastError.mock.calls[0][0]).toContain('L:codex could not be launched')
  })

  it('reports a partial start with the count and reason', () => {
    spawnConsoles
      .mockReturnValueOnce({ cardIds: ['c1'], failed: 0 })
      .mockReturnValueOnce({ cardIds: [], failed: 1 })
      .mockReturnValueOnce({ cardIds: ['c3'], failed: 0 })
    expect(spawnTeamOnBoard('wt', slots, { x: 0, y: 0 }, 'Crew')).toEqual(['c1', 'c3'])
    expect(toastError.mock.calls[0][0]).toMatch(/^1 of 3 consoles did not start: /)
    expect(createGroup).toHaveBeenCalledWith('wt', { name: 'Crew', cardIds: ['c1', 'c3'] })
  })

  it('confirms a full start', () => {
    spawnConsoles.mockImplementation(() => ({ cardIds: [`c${Math.random()}`], failed: 0 }))
    expect(spawnTeamOnBoard('wt', slots, { x: 0, y: 0 }, 'Crew')).toHaveLength(3)
    expect(toastSuccess).toHaveBeenCalledWith('Started Crew: 3 consoles.')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('warns when a spawned console closes right away, then stops watching', () => {
    vi.useFakeTimers()
    try {
      spawnConsoles
        .mockReturnValueOnce({ cardIds: ['c1'], failed: 0 })
        .mockReturnValueOnce({ cardIds: ['c2'], failed: 0 })
        .mockReturnValueOnce({ cardIds: ['c3'], failed: 0 })
      boardCards = [
        { id: 'c1', kind: 'console', tabId: 't1', title: 'Codex 1', agentKind: 'codex' },
        { id: 'c2', kind: 'console', tabId: 't2', title: 'Codex 2', agentKind: 'codex' },
        { id: 'c3', kind: 'console', tabId: 't3', title: 'Codex 3', agentKind: 'codex' }
      ]
      setStore({ tabsByWorktree: { wt: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] } })
      spawnTeamOnBoard('wt', slots, { x: 0, y: 0 })
      setStore({ tabsByWorktree: { wt: [{ id: 't1' }, { id: 't3' }] } })
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError.mock.calls[0][0]).toContain('Codex 2 closed right after it started')
      vi.advanceTimersByTime(EARLY_EXIT_WINDOW_MS + 1)
      setStore({ tabsByWorktree: { wt: [] } })
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(listeners.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
