import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import {
  isCommandGroup,
  normalizeCommandPositionals,
  parseArgs,
  validateCommandAndFlags
} from '../args'
import { COMMAND_SPECS } from '../specs'
import { APP_UI_HANDLERS, formatSettings, parseSettingValue } from './app-ui'
import { ACCOUNT_HANDLERS, formatAccounts } from './accounts'

let logged: string[] = []

beforeEach(() => {
  logged = []
  vi.restoreAllMocks()
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line)
  })
})

const HANDLERS = { ...APP_UI_HANDLERS, ...ACCOUNT_HANDLERS }

async function run(argv: string[], result: unknown = {}) {
  const parsed = normalizeCommandPositionals(COMMAND_SPECS, parseArgs(argv))
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  const handler = HANDLERS[parsed.commandPath.join(' ')]
  expect(handler, `no handler for ${parsed.commandPath.join(' ')}`).toBeDefined()
  const call = vi.fn(async () => ({ id: 'r', ok: true, result }))
  await handler({ flags: parsed.flags, client: { call }, cwd: '/', json: false } as unknown as HandlerContext)
  return call
}

describe('settings, view, notify and accounts CLI', () => {
  it('registers every command', () => {
    for (const key of Object.keys(HANDLERS)) {
      expect(COMMAND_SPECS.some((spec) => spec.path.join(' ') === key)).toBe(true)
    }
    for (const group of ['settings', 'view', 'accounts']) {
      expect(isCommandGroup([group])).toBe(true)
    }
  })

  it('settings set parses JSON values and keeps plain words as text', async () => {
    let call = await run(['settings', 'set', 'compactWorktreeCards', 'true'], {
      key: 'compactWorktreeCards',
      value: true
    })
    expect(call).toHaveBeenCalledWith('settings.set', { key: 'compactWorktreeCards', value: true })
    call = await run(['settings', 'set', 'defaultTuiAgent', 'codex'], { key: 'x', value: 'codex' })
    expect(call).toHaveBeenCalledWith('settings.set', { key: 'defaultTuiAgent', value: 'codex' })
    expect(parseSettingValue('["a","b"]')).toEqual(['a', 'b'])
    expect(parseSettingValue('null')).toBeNull()
  })

  it('settings get shows one key and marks app-only settings', async () => {
    await run(['settings', 'get', 'agentDefaultEnv'], {
      settings: { agentDefaultEnv: { claude: { K: '[hidden]' } }, compactWorktreeCards: true },
      settable: ['compactWorktreeCards']
    })
    expect(logged.at(-1)).toBe('agentDefaultEnv: {"claude":{"K":"[hidden]"}}  (change in the app)')
    expect(formatSettings({ settings: {}, settable: [] }, 'nope')).toContain('No setting named')
  })

  it('view open sends board/tasks/settings to the window and worktree to worktree.activate', async () => {
    let call = await run(['view', 'open', 'tasks'], { view: 'tasks' })
    expect(call).toHaveBeenCalledWith('ui.openView', { view: 'tasks' })
    call = await run(['view', 'open', 'worktree', '--worktree', 'id:w1'], { worktreeId: 'w1' })
    expect(call).toHaveBeenCalledWith('worktree.activate', { worktree: 'id:w1' })
    await expect(run(['view', 'open', 'files'])).rejects.toThrow(/View must be/)
    await expect(run(['view', 'open', 'board', '--worktree', 'id:w1'])).rejects.toThrow(
      /only goes with/
    )
  })

  it('notify caps its text and calls the native notification', async () => {
    const call = await run(['notify', '--title', 'Done', '--body', 'Tests pass'], { shown: true })
    expect(call).toHaveBeenCalledWith('nativeUx.showNotification', { title: 'Done', body: 'Tests pass' })
    await expect(run(['notify', '--title', 'x'.repeat(121), '--body', 'b'])).rejects.toThrow(/under 120/)
  })

  it('accounts use takes exactly one provider and maps system to null', async () => {
    let call = await run(['accounts', 'use', '--codex', 'system'])
    expect(call).toHaveBeenCalledWith('accounts.selectCodex', { accountId: null })
    call = await run(['accounts', 'use', '--claude', 'a1'])
    expect(call).toHaveBeenCalledWith('accounts.selectClaude', { accountId: 'a1' })
    await expect(run(['accounts', 'use'])).rejects.toThrow(/exactly one/)
    await expect(run(['accounts', 'use', '--claude', 'a', '--codex', 'b'])).rejects.toThrow(/exactly one/)
    expect(
      formatAccounts({
        claude: { accounts: [{ id: 'a1', email: 'c@x' }], activeAccountId: 'a1' },
        codex: { accounts: [], activeAccountId: null }
      } as never)
    ).toBe('Claude:\n* a1  c@x\nCodex (using the system sign-in):\n  no accounts added in Dobius+')
  })
})
