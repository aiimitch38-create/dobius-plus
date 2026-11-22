import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'

vi.mock('electron', () => ({ BrowserWindow: { fromId: vi.fn() } }))

import { buildAppUiMethods, maskCommandLine } from './app-ui'

const SETTINGS = {
  defaultTuiAgent: 'claude',
  agentCmdOverrides: { claude: 'claude --api-key sk-abc123 --model opus' },
  agentDefaultArgs: { codex: '--token=abcd TOKEN=zzz --fast' },
  agentDefaultEnv: { claude: { ANTHROPIC_API_KEY: 'sk-live', HTTP_PROXY: 'http://x' } },
  agentStatusHooksEnabled: true,
  compactWorktreeCards: false
}
const updateClientSettings = vi.fn((patch: Record<string, unknown>) => ({ ...SETTINGS, ...patch }))
const runtime = {
  getRuntimeId: () => 'test-runtime',
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

  it('reads settings with every env value hidden and command secrets masked', async () => {
    const response = await call('settings.read')
    const text = JSON.stringify(response)
    expect(text).not.toContain('sk-live')
    expect(text).not.toContain('sk-abc123')
    expect(text).not.toContain('abcd')
    expect(text).not.toContain('zzz')
    expect(response).toMatchObject({
      ok: true,
      result: {
        settings: {
          agentDefaultEnv: { claude: { ANTHROPIC_API_KEY: '[hidden]', HTTP_PROXY: '[hidden]' } },
          agentCmdOverrides: { claude: 'claude --api-key [hidden] --model opus' }
        }
      }
    })
  })

  it('masks key-shaped words and secret flags in command lines', () => {
    expect(maskCommandLine('run --password hunter2 --verbose')).toBe(
      'run --password [hidden] --verbose'
    )
    expect(maskCommandLine('x ghp_abcdefghijklmnop')).toBe('x [hidden]')
    expect(maskCommandLine('--model opus')).toBe('--model opus')
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
