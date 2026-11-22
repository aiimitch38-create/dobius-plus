import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'

vi.mock('electron', () => ({ BrowserWindow: { fromId: vi.fn() } }))

import { buildAppUiMethods } from './app-ui'

const SETTINGS = {
  defaultTuiAgent: 'claude',
  agentCmdOverrides: { claude: 'claude --api-key sk-abc123 --model opus' },
  agentDefaultArgs: {
    codex: '--token=abcd TOKEN=zzz --fast',
    claude: `--token="Bearer test-token" '{"apiKey":"short-test-key"}'`
  },
  agentDefaultEnv: { claude: { ANTHROPIC_API_KEY: 'sk-live', HTTP_PROXY: 'http://x' } },
  agentStatusHooksEnabled: true,
  compactWorktreeCards: false
}
const updateClientSettings = vi.fn((patch: Record<string, unknown>) => ({ ...SETTINGS, ...patch }))
const runtime = {
  getRuntimeId: () => 'test-runtime',
  refreshAccountsForMobile: vi.fn(async () => undefined),
  getAccountsSnapshot: () => ({
    claude: { accounts: [], activeAccountId: null },
    codex: { accounts: [], activeAccountId: null },
    rateLimits: {
      claude: { status: 'ok', cliOutput: 'Signed in as carson@example.com' },
      codex: null,
      gemini: null,
      opencodeGo: null,
      kimi: null,
      minimax: null,
      inactiveClaudeAccounts: [{ accountId: 'a', rateLimits: { cliOutput: 'raw screen' } }],
      inactiveCodexAccounts: []
    }
  }),
  getClientSettings: () => SETTINGS,
  updateClientSettings
} as unknown as DobiusRuntimeService

const win = {
  isMinimized: () => false,
  restore: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  webContents: { send: vi.fn() }
}
let windowOpen = true
const methods = buildAppUiMethods({ mainWindow: () => (windowOpen ? (win as never) : null) })

function call(method: string, params?: unknown) {
  const request: RpcRequest = { id: 'req-1', authToken: 'tok', method, params }
  return new RpcDispatcher({ runtime, methods }).dispatch(request)
}

describe('settings and view RPC methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    windowOpen = true
  })

  it('reads settings with every agent command, argument and env value hidden', async () => {
    const response = await call('settings.read')
    const text = JSON.stringify(response)
    for (const secret of ['sk-live', 'sk-abc123', 'abcd', 'zzz', 'test-token', 'short-test-key']) {
      expect(text).not.toContain(secret)
    }
    expect(response).toMatchObject({
      ok: true,
      result: {
        settings: {
          agentDefaultEnv: { claude: { ANTHROPIC_API_KEY: '[hidden]', HTTP_PROXY: '[hidden]' } },
          agentCmdOverrides: { claude: '[hidden]' },
          agentDefaultArgs: { codex: '[hidden]', claude: '[hidden]' },
          defaultTuiAgent: 'claude'
        }
      }
    })
  })

  it('sets an allowlisted key after checking its value', async () => {
    expect(await call('settings.set', { key: 'compactWorktreeCards', value: true })).toMatchObject({
      ok: true,
      result: { key: 'compactWorktreeCards', value: true }
    })
    expect(updateClientSettings).toHaveBeenCalledWith({ compactWorktreeCards: true })
    expect(await call('settings.set', { key: 'compactWorktreeCards', value: 'yes' })).toMatchObject(
      { ok: false }
    )
    expect(await call('settings.set', { key: 'defaultTuiAgent', value: 'rm -rf' })).toMatchObject({
      ok: false
    })
  })

  it('refuses keys outside the allowlist: secrets, launch args and safety switches', async () => {
    for (const key of [
      'agentDefaultEnv',
      'agentDefaultArgs',
      'agentCmdOverrides',
      'agentStatusHooksEnabled',
      'minimaxGroupId',
      'agentsPaused',
      'voice',
      '__proto__',
      'constructor'
    ]) {
      const response = await call('settings.set', { key, value: true })
      expect(JSON.stringify(response)).toContain('cannot be changed from the command line')
    }
    expect(updateClientSettings).not.toHaveBeenCalled()
  })

  it('accounts.summary drops the raw CLI usage screen text', async () => {
    const response = await call('accounts.summary')
    expect(response).toMatchObject({ ok: true, result: { rateLimits: { claude: { status: 'ok' } } } })
    expect(JSON.stringify(response)).not.toContain('carson@example.com')
    expect(JSON.stringify(response)).not.toContain('raw screen')
  })

  it('opens a view in the main window, or says the window is closed', async () => {
    expect(await call('ui.openView', { view: 'board' })).toMatchObject({
      ok: true,
      result: { view: 'board' }
    })
    expect(win.webContents.send).toHaveBeenCalledWith('ui:openWorkspaceBoard')
    expect(win.focus).toHaveBeenCalled()
    expect(await call('ui.openView', { view: 'files' })).toMatchObject({ ok: false })
    windowOpen = false
    expect(JSON.stringify(await call('ui.openView', { view: 'tasks' }))).toContain('not open')
  })
})
