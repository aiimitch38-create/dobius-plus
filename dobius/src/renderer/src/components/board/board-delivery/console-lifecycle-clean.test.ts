import { beforeEach, describe, expect, it, vi } from 'vitest'

const closeTerminalTab = vi.fn()
const removeCards = vi.fn()
const getForegroundProcess = vi.fn(async () => 'hermes')

type Card = { id: string; kind: string; tabId: string; title: string }
const state = {
  tabsByWorktree: {} as Record<string, { id: string }[]>,
  ptyIdsByTabId: {} as Record<string, string[]>,
  removeCards
}
let cards: Card[] = []

vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: vi.fn() }))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))
vi.mock('@/store/slices/board', () => ({ getBoard: () => ({ cards, groups: [] }) }))
vi.mock('./board-pause', () => ({ markConsolePaused: vi.fn() }))
vi.mock('../console-card/console-account-launch', () => ({ resolvePinnedAgentCommand: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/lib/agent-catalog', () => ({ getAgentLabel: (a: string) => a }))

const { cleanDeadLanes, isConsoleEnded } = await import('./console-lifecycle')
const { markBoardConsoleEnded, isBoardConsoleEnded, resetBoardConsoleEndedForTest } =
  await import('../console-card/board-console-exit')

const consoleCard = (id: string, tabId: string): Card => ({ id, kind: 'console', tabId, title: id })

beforeEach(() => {
  vi.clearAllMocks()
  resetBoardConsoleEndedForTest()
  vi.stubGlobal('window', { api: { pty: { getForegroundProcess } } })
  state.tabsByWorktree = { wt: [{ id: 'tab-ended' }, { id: 'tab-spawning' }, { id: 'tab-live' }] }
  state.ptyIdsByTabId = { 'tab-ended': [], 'tab-live': ['pty-live'] }
  cards = [
    consoleCard('ended', 'tab-ended'),
    consoleCard('spawning', 'tab-spawning'),
    consoleCard('live', 'tab-live')
  ]
})

describe('cleanDeadLanes after a Board console PTY exit', () => {
  it('closes a console whose PTY exited under the card, not one that is still spawning', async () => {
    // The keep-pane exit path records the tab; the store has already dropped its PTY id.
    markBoardConsoleEnded('tab-ended')

    expect(await isConsoleEnded(cards[0] as never)).toBe(true)
    expect(await isConsoleEnded(cards[1] as never)).toBe(false)
    expect(await isConsoleEnded(cards[2] as never)).toBe(false)

    expect(await cleanDeadLanes('wt')).toEqual(['ended'])
    expect(closeTerminalTab).toHaveBeenCalledTimes(1)
    expect(closeTerminalTab).toHaveBeenCalledWith('tab-ended')
    expect(removeCards).toHaveBeenCalledWith('wt', ['ended'])
    // The marker is consumed with the tab.
    expect(isBoardConsoleEnded('tab-ended')).toBe(false)
  })

  it('a tab with no PTY that never ended is left alone', async () => {
    expect(await cleanDeadLanes('wt')).toEqual([])
    expect(closeTerminalTab).not.toHaveBeenCalled()
    expect(removeCards).toHaveBeenCalledWith('wt', [])
  })

  it('an ended marker is ignored once a new PTY runs in the tab', async () => {
    markBoardConsoleEnded('tab-live')
    getForegroundProcess.mockResolvedValueOnce('hermes')
    expect(await isConsoleEnded(cards[2] as never)).toBe(false)
  })
})
