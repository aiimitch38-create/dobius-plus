import { beforeEach, describe, expect, it, vi } from 'vitest'

// Team spawns run the real launch path (launchTeam -> spawnConsoles ->
// launchAgentInNewTab), the same one "New console" uses, so the per-agent
// command override from Settings > Agents must reach the queued startup command.

const createTab = vi.fn()
const queueTabStartupCommand = vi.fn()
const addCard = vi.fn()

const store = {
  settings: {
    agentCmdOverrides: {} as Record<string, string>,
    agentDefaultArgs: {} as Record<string, string>,
    agentDefaultEnv: {} as Record<string, Record<string, string>>,
    activeRuntimeEnvironmentId: null as string | null
  },
  projects: [{ id: 'repo-1', localWindowsRuntimePreference: { kind: 'inherit-global' as const } }],
  repos: [{ id: 'repo-1', connectionId: null as string | null, path: '/repo' }],
  worktreesByRepo: {
    'repo-1': [
      { id: 'wt-1', repoId: 'repo-1', projectId: 'repo-1', path: '/repo/wt', displayName: 'main' }
    ]
  },
  allWorktrees: () => store.worktreesByRepo['repo-1'],
  tabsByWorktree: { 'wt-1': [] as { id: string }[] },
  openFiles: [],
  browserTabsByWorktree: {},
  tabBarOrderByWorktree: {},
  terminalLayoutsByTabId: {},
  createTab,
  queueTabStartupCommand,
  addCard,
  setActiveTabType: vi.fn(),
  setTabBarOrder: vi.fn(),
  setAgentStatus: vi.fn(),
  seedNativeChatLaunchPrompt: vi.fn(),
  markNativeChatLaunchPromptFailed: vi.fn()
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => store, subscribe: () => () => {} } }))
vi.mock('@/store/slices/board', () => ({
  getBoard: () => ({ cards: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } })
}))
vi.mock('sonner', () => ({ toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/tab-bar/reconcile-order', () => ({
  reconcileTabOrder: vi.fn((_s, t: string[], e: string[], b: string[]) => [...t, ...e, ...b])
}))
vi.mock('@/lib/agent-paste-draft', () => ({ pasteDraftWhenAgentReady: vi.fn() }))
vi.mock('@/lib/telemetry', () => ({ track: vi.fn(), tuiAgentToAgentKind: (a: string) => a }))
vi.mock('@/runtime/web-runtime-session', () => ({
  createWebRuntimeSessionTerminal: vi.fn(),
  isWebRuntimeSessionActive: vi.fn(() => false),
  isWebTerminalSurfaceTabId: vi.fn(() => false)
}))

const { launchTeam } = await import('./board-team-spawn')
const { launchAgentInNewTab } = await import('@/lib/launch-agent-in-new-tab')

const OVERRIDE = '/nonexistent/bin/claude-fake'

beforeEach(() => {
  vi.clearAllMocks()
  let n = 0
  createTab.mockImplementation(() => ({ id: `tab-${++n}` }))
  addCard.mockImplementation((_wt: string, card: { tabId: string }) => `card-${card.tabId}`)
  store.settings.agentCmdOverrides = { claude: OVERRIDE }
})

describe('team spawn honours the per-agent command override', () => {
  it('queues the overridden command for every console in the team', () => {
    const outcome = launchTeam(
      'wt-1',
      [
        { role: 'general', agent: 'claude' },
        { role: 'general', agent: 'claude' }
      ],
      { x: 0, y: 0 }
    )
    expect(outcome.failed).toBe(0)
    expect(outcome.cardIds).toHaveLength(2)
    expect(queueTabStartupCommand).toHaveBeenCalledTimes(2)
    for (const [, startup] of queueTabStartupCommand.mock.calls) {
      expect((startup as { command: string }).command).toContain(OVERRIDE)
    }
  })

  it('builds the same startup command as a plain New console', () => {
    launchTeam('wt-1', [{ role: 'general', agent: 'claude' }], { x: 0, y: 0 })
    const team = (queueTabStartupCommand.mock.calls[0][1] as { command: string }).command
    queueTabStartupCommand.mockClear()
    launchAgentInNewTab({ agent: 'claude', worktreeId: 'wt-1', launchSource: 'unknown' })
    const single = (queueTabStartupCommand.mock.calls[0][1] as { command: string }).command
    expect(team).toBe(single)
  })
})
