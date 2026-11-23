import { beforeEach, describe, expect, it, vi } from 'vitest'

const launchAgentInNewTab = vi.fn()
const updateCard = vi.fn()
const setTabAgentName = vi.fn()
const closeTerminalTab = vi.fn()
const resolvePinnedAgentCommand = vi.fn()
const toastError = vi.fn()
let worktrees: { id: string; path: string }[] = []
let tabsByWorktree: Record<string, { id: string; agentName?: string }[]> = {}
const launchConfigs: Record<string, { launchConfig: { agentCommand?: string; agentArgs: string } }> = {}

vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab }))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({
      updateCard,
      setTabAgentName,
      agentLaunchConfigByPaneKey: launchConfigs,
      allWorktrees: () => worktrees,
      tabsByWorktree
    }) }
}))
const flushBoardPersistence = vi.fn(async () => {})
vi.mock('@/store/slices/board', () => ({ getBoard: vi.fn(), flushBoardPersistence }))
vi.mock('./board-pause', () => ({ markConsolePaused: vi.fn() }))
vi.mock('../console-card/console-card-status', () => ({ isShellProcessName: vi.fn() }))
vi.mock('../console-card/console-account-launch', () => ({ resolvePinnedAgentCommand }))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => values?.[k] ?? '')
}))
vi.mock('@/lib/agent-catalog', () => ({ getAgentLabel: (a: string) => a }))

const { restartConsole, restartConsoleAndWait } = await import('./console-lifecycle')

type Card = Parameters<typeof restartConsole>[1]
const card = (extra: Partial<Card> = {}): Card =>
  ({
    id: 'card-1',
    kind: 'console',
    tabId: 'old-tab',
    agentKind: 'claude',
    title: 'C',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    z: 0,
    ...extra
  }) as Card

beforeEach(() => {
  vi.clearAllMocks()
  worktrees = []
  tabsByWorktree = {}
  for (const key of Object.keys(launchConfigs)) {
    delete launchConfigs[key]
  }
  launchAgentInNewTab.mockReturnValue({ tabId: 'new-tab' })
})

describe('restartConsole agent name', () => {
  it('gives the replacement tab the old tab name so the card and tab stay one name', async () => {
    tabsByWorktree = { wt: [{ id: 'old-tab', agentName: 'Juniper' }] }
    expect(restartConsole('wt', card({ title: 'Juniper' }))).toBe(true)
    expect(setTabAgentName).toHaveBeenCalledWith('new-tab', 'Juniper')
    // Why: renamed before the card points at the new tab and before the old one closes.
    expect(setTabAgentName.mock.invocationCallOrder[0]).toBeLessThan(
      updateCard.mock.invocationCallOrder[0]!
    )
    await vi.waitFor(() => expect(closeTerminalTab).toHaveBeenCalledWith('old-tab'))
  })

  it('keeps the name on restartConsoleAndWait too', async () => {
    tabsByWorktree = { wt: [{ id: 'old-tab', agentName: 'Juniper' }] }
    await expect(restartConsoleAndWait('wt', card())).resolves.toBe(true)
    expect(setTabAgentName).toHaveBeenCalledWith('new-tab', 'Juniper')
  })

  it('leaves the fresh name alone for a tab that never had one', () => {
    tabsByWorktree = { wt: [{ id: 'old-tab' }] }
    restartConsole('wt', card())
    expect(setTabAgentName).not.toHaveBeenCalled()
  })
})

describe('restartConsole account handling', () => {
  it("keeps today's launch when nothing is pinned", async () => {
    expect(restartConsole('wt', card())).toBe(true)
    expect(launchAgentInNewTab).toHaveBeenCalledWith({
      agent: 'claude',
      worktreeId: 'wt',
      launchSource: 'unknown'
    })
    expect(updateCard).toHaveBeenCalledWith('wt', 'card-1', {
      tabId: 'new-tab',
      agentKind: 'claude',
      accountId: undefined
    })
    await vi.waitFor(() => expect(closeTerminalTab).toHaveBeenCalledWith('old-tab'))
  })

  it('launches a pinned command and records the account', () => {
    restartConsole('wt', card(), 'codex', {
      agentCommandOverride: "CODEX_HOME='/p' codex",
      accountId: 'x1'
    })
    expect(launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'codex', agentCommandOverride: "CODEX_HOME='/p' codex" })
    )
    expect(updateCard).toHaveBeenCalledWith('wt', 'card-1', {
      tabId: 'new-tab',
      agentKind: 'codex',
      accountId: 'x1'
    })
  })

  it('a plain restart of a pinned console stays on its account', async () => {
    resolvePinnedAgentCommand.mockResolvedValue({ command: "CLAUDE_CONFIG_DIR='/p' claude" })
    expect(restartConsole('wt', card({ accountId: 'c1' }))).toBe(true)
    expect(launchAgentInNewTab).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(launchAgentInNewTab).toHaveBeenCalled())
    expect(resolvePinnedAgentCommand).toHaveBeenCalledWith('wt', 'claude', 'c1')
    expect(launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ agentCommandOverride: "CLAUDE_CONFIG_DIR='/p' claude" })
    )
    expect(updateCard).toHaveBeenCalledWith(
      'wt',
      'card-1',
      expect.objectContaining({ accountId: 'c1' })
    )
  })

  it('never falls back to the default account when the pin cannot be prepared', async () => {
    resolvePinnedAgentCommand.mockRejectedValue(new Error('That account no longer exists.'))
    restartConsole('wt', card({ accountId: 'gone' }))
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(launchAgentInNewTab).not.toHaveBeenCalled()
    expect(closeTerminalTab).not.toHaveBeenCalled()
  })

  it("switching to another agent drops the old agent's pin", () => {
    restartConsole('wt', card({ accountId: 'c1' }), 'gemini')
    expect(resolvePinnedAgentCommand).not.toHaveBeenCalled()
    expect(updateCard).toHaveBeenCalledWith('wt', 'card-1', {
      tabId: 'new-tab',
      agentKind: 'gemini',
      accountId: undefined
    })
  })
})

describe('restartConsole keeps a bug-fix console restricted', () => {
  const restricted =
    "claude '--restricted' '--strict-mcp-config' '--tools' 'Bash,Read' '--permission-mode' 'acceptEdits'"

  it('relaunches with the current profile, never an older captured one', async () => {
    const { bugFixClaudeArgs } = await import('../../../../../shared/bug-fix-agent-profile')
    worktrees = [{ id: 'wt', path: '/ws/dobius-plus/autofix-login-abcd1234' }]
    launchConfigs['old-tab:11111111-1111-4111-8111-111111111111'] = {
      launchConfig: { agentCommand: `${restricted} '--allowedTools' 'Bash(npx vitest run *)'`, agentArgs: '' }
    }
    expect(restartConsole('wt', card(), 'codex')).toBe(true)
    expect(launchAgentInNewTab).toHaveBeenCalledWith({
      agent: 'claude',
      worktreeId: 'wt',
      launchSource: 'unknown',
      agentCommandOverride: 'claude',
      agentArgs: bugFixClaudeArgs()
    })
    expect(resolvePinnedAgentCommand).not.toHaveBeenCalled()
    // The old tab still closes only after the board save (9.7).
    await vi.waitFor(() => expect(closeTerminalTab).toHaveBeenCalledWith('old-tab'))
    expect(flushBoardPersistence).toHaveBeenCalledTimes(1)
  })

  it('stays restricted after the agent exited and its captured launch is gone', async () => {
    const { bugFixClaudeArgs } = await import('../../../../../shared/bug-fix-agent-profile')
    worktrees = [{ id: 'wt', path: '/ws/dobius-plus/autofix-login-abcd1234' }]
    expect(restartConsole('wt', card(), 'codex')).toBe(true)
    expect(launchAgentInNewTab).toHaveBeenCalledWith({
      agent: 'claude',
      worktreeId: 'wt',
      launchSource: 'unknown',
      agentCommandOverride: 'claude',
      agentArgs: bugFixClaudeArgs()
    })
  })

  it("leaves other consoles' restarts unchanged", () => {
    launchConfigs['old-tab:11111111-1111-4111-8111-111111111111'] = {
      launchConfig: { agentCommand: "claude '--dangerously-skip-permissions'", agentArgs: '' }
    }
    restartConsole('wt', card())
    expect(launchAgentInNewTab).toHaveBeenCalledWith({
      agent: 'claude',
      worktreeId: 'wt',
      launchSource: 'unknown'
    })
  })
})

describe('restartConsole keeps the card address correct (9.7)', () => {
  it('saves the new tab to main before closing the old terminal', async () => {
    let landed: () => void = () => {}
    flushBoardPersistence.mockImplementationOnce(
      () => new Promise<void>((resolve) => (landed = resolve))
    )
    expect(restartConsole('wt', card())).toBe(true)
    expect(updateCard).toHaveBeenCalledWith('wt', 'card-1', expect.objectContaining({ tabId: 'new-tab' }))
    // Why: until main has the new tabId, card:card-1 would still resolve to old-tab.
    expect(flushBoardPersistence).toHaveBeenCalledTimes(1)
    expect(updateCard.mock.invocationCallOrder[0]).toBeLessThan(
      flushBoardPersistence.mock.invocationCallOrder[0]
    )
    await Promise.resolve()
    expect(closeTerminalTab).not.toHaveBeenCalled()
    landed()
    await vi.waitFor(() => expect(closeTerminalTab).toHaveBeenCalledWith('old-tab'))
  })

  it('leaves the old terminal open and says so when main refused the save', async () => {
    flushBoardPersistence.mockRejectedValueOnce(new Error('ipc down'))
    expect(restartConsole('wt', card())).toBe(true)
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(String(toastError.mock.calls[0][0])).toContain('old terminal was left open: ipc down')
    expect(closeTerminalTab).not.toHaveBeenCalled()
  })
})

describe('restartConsoleAndWait (dobius board restart)', () => {
  it('resolves only after the pinned account is ready, the save landed and the old tab closed with the given option', async () => {
    let pinReady: (v: { command: string }) => void = () => {}
    resolvePinnedAgentCommand.mockImplementationOnce(() => new Promise((resolve) => (pinReady = resolve)))
    let finished = false
    const run = restartConsoleAndWait('wt', card({ accountId: 'c1' }), { closeOldTab: { force: true } }).then((ok) => {
      finished = true
      return ok
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    expect(launchAgentInNewTab).not.toHaveBeenCalled()
    pinReady({ command: "CLAUDE_CONFIG_DIR='/p' claude" })
    expect(await run).toBe(true)
    expect(launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ agentCommandOverride: "CLAUDE_CONFIG_DIR='/p' claude" })
    )
    expect(updateCard).toHaveBeenCalledWith('wt', 'card-1', expect.objectContaining({ accountId: 'c1' }))
    expect(closeTerminalTab).toHaveBeenCalledWith('old-tab', { force: true })
  })

  it('launches nothing when the card changed while the account was prepared', async () => {
    resolvePinnedAgentCommand.mockResolvedValue({ command: 'x' })
    expect(await restartConsoleAndWait('wt', card({ accountId: 'c1' }), { stillCurrent: () => false })).toBe(false)
    expect(launchAgentInNewTab).not.toHaveBeenCalled()
    expect(closeTerminalTab).not.toHaveBeenCalled()
  })

  it('keeps a bug-fix console on the restricted profile', async () => {
    const { bugFixClaudeArgs } = await import('../../../../../shared/bug-fix-agent-profile')
    worktrees = [{ id: 'wt', path: '/ws/dobius-plus/autofix-login-abcd1234' }]
    expect(await restartConsoleAndWait('wt', card({ agentKind: 'codex' }))).toBe(true)
    expect(launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'claude', agentCommandOverride: 'claude', agentArgs: bugFixClaudeArgs() })
    )
  })
})
