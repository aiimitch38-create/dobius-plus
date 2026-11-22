import { beforeEach, describe, expect, it, vi } from 'vitest'

const launchAgentInNewTab = vi.fn()
const updateCard = vi.fn()
const closeTerminalTab = vi.fn()
const resolvePinnedAgentCommand = vi.fn()
const toastError = vi.fn()

vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab }))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({ updateCard }) } }))
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
