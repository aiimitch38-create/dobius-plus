import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnConsoles = vi.fn()
const toastError = vi.fn()
const toastSuccess = vi.fn()
const groupBoardCards = vi.fn()
const createGroup = vi.fn()
const setViewport = vi.fn()

type Listener = (state: StoreState, prev: StoreState) => void
type StoreState = {
  tabsByWorktree: Record<string, { id: string }[]>
  boardsByWorktree: Record<string, unknown>
  createGroup: typeof createGroup
  setViewport: typeof setViewport
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
type TestCard = { id: string; kind: string; tabId: string; title: string; agentKind: string }
let boardCards: (TestCard & { x?: number; y?: number; w?: number; h?: number })[]
let boardViewport = { x: 0, y: 0, zoom: 1 }

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
vi.mock('@/store/slices/board', () => ({
  getBoard: () => ({
    cards: boardCards.map((c) => ({ x: 0, y: 0, w: 10, h: 10, ...c })),
    groups: [],
    viewport: boardViewport
  })
}))
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

// Reduced motion: the reveal pan applies synchronously.
vi.stubGlobal('window', {
  innerWidth: 1440,
  innerHeight: 900,
  matchMedia: () => ({ matches: true })
})

const { spawnTeamOnBoard, EARLY_EXIT_WINDOW_MS } = await import('./board-team-spawn')
const { BOARD_CHROME_INSETS } = await import('../board-canvas/board-reveal')

const slots = [
  { role: 'general' as const, agent: 'codex' as const },
  { role: 'general' as const, agent: 'codex' as const },
  { role: 'general' as const, agent: 'codex' as const }
]

beforeEach(() => {
  vi.clearAllMocks()
  listeners.clear()
  boardCards = []
  boardViewport = { x: 0, y: 0, zoom: 1 }
  storeState = { tabsByWorktree: { wt: [] }, boardsByWorktree: {}, createGroup, setViewport }
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

  it('pans so a team that landed under the right rail is fully in the safe area', () => {
    spawnConsoles
      .mockReturnValueOnce({ cardIds: ['c1'], failed: 0 })
      .mockReturnValueOnce({ cardIds: ['c2'], failed: 0 })
    const card = (id: string, x: number, y: number) => ({
      id,
      kind: 'console',
      tabId: `t-${id}`,
      title: id,
      agentKind: 'codex',
      x,
      y,
      w: 640,
      h: 400
    })
    // Two consoles side by side, starting past the right edge at 50%.
    boardViewport = { x: 0, y: 0, zoom: 0.5 }
    boardCards = [card('c1', 2600, 200), card('c2', 3272, 200)]
    spawnTeamOnBoard('wt', slots.slice(0, 2), { x: 0, y: 0 })
    expect(setViewport).toHaveBeenCalled()
    const v = setViewport.mock.calls.at(-1)![1] as { x: number; y: number; zoom: number }
    const left = 2600 * v.zoom + v.x
    const right = (3272 + 640) * v.zoom + v.x
    expect(left).toBeGreaterThanOrEqual(BOARD_CHROME_INSETS.left)
    expect(right).toBeLessThanOrEqual(1440 - BOARD_CHROME_INSETS.right)
    expect(200 * v.zoom + v.y).toBeGreaterThanOrEqual(BOARD_CHROME_INSETS.top)
    expect(600 * v.zoom + v.y).toBeLessThanOrEqual(900 - BOARD_CHROME_INSETS.bottom)
  })

  it('leaves the camera alone when the team is already visible', () => {
    spawnConsoles.mockReturnValueOnce({ cardIds: ['c1'], failed: 0 })
    boardCards = [
      {
        id: 'c1',
        kind: 'console',
        tabId: 't1',
        title: 'c1',
        agentKind: 'codex',
        x: 300,
        y: 200,
        w: 640,
        h: 400
      }
    ]
    spawnTeamOnBoard('wt', slots.slice(0, 1), { x: 0, y: 0 })
    expect(setViewport).not.toHaveBeenCalled()
  })
})
