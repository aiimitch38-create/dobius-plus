import { describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: { getState: vi.fn() } }))
vi.mock('@/store/slices/board', () => ({ getBoard: vi.fn() }))
vi.mock('../board-delivery/board-delivery', () => ({ consoleDeliveryState: vi.fn() }))
vi.mock('../board-delivery/console-lifecycle', () => ({ restartConsole: vi.fn() }))
vi.mock('../board-delivery/pause-consoles', () => ({
  pauseResultText: vi.fn(),
  setConsolesPaused: vi.fn()
}))
vi.mock('../board-command-bar/board-command-prefill', () => ({
  boardReplyDraft: vi.fn(),
  requestCommandBarPrefill: vi.fn()
}))

const { boardSwitchAgents } = await import('./console-actions')

const base = {
  detectedAgentIds: ['claude', 'codex', 'opencode', 'goose'] as const,
  remoteDetectedAgentIds: { ssh1: ['claude'] as const },
  settings: { disabledTuiAgents: ['goose'] },
  repos: [
    { id: 'local', connectionId: null },
    { id: 'remote', connectionId: 'ssh1' }
  ],
  getKnownWorktreeById: (id: string) => ({ repoId: id === 'wt-remote' ? 'remote' : 'local' })
}

describe('boardSwitchAgents', () => {
  it('offers only detected agents that are enabled (no undetected Gemini)', () => {
    expect(boardSwitchAgents(base, 'wt')).toEqual(['claude', 'codex', 'opencode'])
  })

  it('uses the remote host detection for SSH worktrees', () => {
    expect(boardSwitchAgents(base, 'wt-remote')).toEqual(['claude'])
  })

  it('offers nothing while detection has not run', () => {
    expect(boardSwitchAgents({ ...base, detectedAgentIds: null }, 'wt')).toEqual([])
  })
})
