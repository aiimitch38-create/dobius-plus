import { beforeEach, describe, expect, it, vi } from 'vitest'

const launchAgentInNewTab = vi.fn()
const updateCard = vi.fn()
const closeTerminalTab = vi.fn()
const resolvePinnedAgentCommand = vi.fn()
const toastError = vi.fn()

vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab }))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({ updateCard }) } }))
vi.mock('@/store/slices/board', () => ({ getBoard: vi.fn() }))
vi.mock('./board-pause', () => ({ markConsolePaused: vi.fn() }))
vi.mock('../console-card/console-card-status', () => ({ isShellProcessName: vi.fn() }))
vi.mock('../console-card/console-account-launch', () => ({ resolvePinnedAgentCommand }))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => values?.[k] ?? '')
}))
vi.mock('@/lib/agent-catalog', () => ({ getAgentLabel: (a: string) => a }))

const { restartConsole } = await import('./console-lifecycle')

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
  launchAgentInNewTab.mockReturnValue({ tabId: 'new-tab' })
})

describe('restartConsole account handling', () => {
  it("keeps today's launch when nothing is pinned", () => {
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
    expect(closeTerminalTab).toHaveBeenCalledWith('old-tab')
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
