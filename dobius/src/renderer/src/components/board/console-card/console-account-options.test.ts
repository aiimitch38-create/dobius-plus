import { describe, expect, it } from 'vitest'
import { buildConsoleAccountOptions, pinnedAccountEmail } from './console-account-options'
import type { ConsoleAccountsSnapshot } from './console-account-options'

const account = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  id,
  email,
  createdAt: 1,
  updatedAt: 1,
  lastAuthenticatedAt: 1,
  ...extra
})

const snapshot: ConsoleAccountsSnapshot = {
  claude: {
    accounts: [
      { ...account('c1', 'a@x'), authMethod: 'subscription-oauth' },
      { ...account('c2', 'b@x'), authMethod: 'subscription-oauth' },
      { ...account('c3', 'wsl@x', { managedAuthRuntime: 'wsl' }), authMethod: 'unknown' }
    ],
    activeAccountId: 'c1',
    activeAccountIdsByRuntime: { host: 'c1', wsl: {} }
  },
  codex: { accounts: [account('x1', 'cx@x')], activeAccountId: null }
}

describe('buildConsoleAccountOptions', () => {
  it('lists a default row plus host accounts per detected CLI', () => {
    const options = buildConsoleAccountOptions({
      snapshot,
      detected: ['claude', 'codex', 'gemini'],
      currentAgent: 'claude',
      currentAccountId: 'c2'
    })
    expect(options.map((o) => [o.agent, o.accountId, o.email, o.current])).toEqual([
      ['claude', null, 'a@x', false],
      ['claude', 'c1', 'a@x', false],
      ['claude', 'c2', 'b@x', true],
      ['codex', null, null, false],
      ['codex', 'x1', 'cx@x', false]
    ])
  })

  it('skips CLIs that are not detected and marks the default as current when unpinned', () => {
    const options = buildConsoleAccountOptions({
      snapshot,
      detected: ['codex'],
      currentAgent: 'codex',
      currentAccountId: undefined
    })
    expect(options.every((o) => o.agent === 'codex')).toBe(true)
    expect(options.find((o) => o.current)?.accountId).toBeNull()
  })

  it('handles accounts that have not loaded yet', () => {
    expect(
      buildConsoleAccountOptions({
        snapshot: { claude: null, codex: null },
        detected: ['claude'],
        currentAgent: 'claude',
        currentAccountId: null
      })
    ).toEqual([{ agent: 'claude', accountId: null, email: null, current: true }])
  })
})

describe('pinnedAccountEmail', () => {
  it('resolves only pinned Claude/Codex consoles', () => {
    expect(pinnedAccountEmail(snapshot, 'claude', 'c2')).toBe('b@x')
    expect(pinnedAccountEmail(snapshot, 'claude', undefined)).toBeNull()
    expect(pinnedAccountEmail(snapshot, 'gemini', 'c2')).toBeNull()
    expect(pinnedAccountEmail(snapshot, 'claude', 'gone')).toBeNull()
  })
})
