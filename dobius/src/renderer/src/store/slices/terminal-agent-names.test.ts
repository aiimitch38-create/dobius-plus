import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_NAMES } from '../../../../shared/agent-names'
import { resolveTerminalTabTitle } from '../../../../shared/tab-title-resolution'
import { parseWorkspaceSession } from '../../../../shared/workspace-session-schema'
import type { AppState } from '../types'
import { collectUsedAgentNames } from './terminals'
import { createTestStore, makeLayout, makeTab, makeWorktree, seedStore } from './store-test-helpers'

const WT_A = 'repo1::/path/wt1'
const WT_B = 'repo1::/path/wt2'

function seedTwoWorktrees(
  store: ReturnType<typeof createTestStore>,
  state: Partial<AppState> = {}
) {
  seedStore(store, {
    worktreesByRepo: {
      repo1: [
        makeWorktree({ id: WT_A, repoId: 'repo1', path: '/path/wt1' }),
        makeWorktree({ id: WT_B, repoId: 'repo1', path: '/path/wt2' })
      ]
    },
    ...state
  })
}

describe('agent names on new terminals', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('skips names already used anywhere: other projects, manual renames and console cards', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const store = createTestStore()
    seedTwoWorktrees(store, {
      tabsByWorktree: {
        [WT_B]: [
          makeTab({ id: 'b1', worktreeId: WT_B, agentName: AGENT_NAMES[0] }),
          makeTab({
            id: 'b2',
            worktreeId: WT_B,
            customTitle: AGENT_NAMES[1].toLowerCase()
          })
        ]
      },
      boardsByWorktree: {
        [WT_B]: {
          cards: [
            {
              id: 'card-1',
              kind: 'console',
              tabId: 'b1',
              title: AGENT_NAMES[2]
            }
          ]
        }
      } as unknown as AppState['boardsByWorktree']
    })

    const tab = store.getState().createTab(WT_A)

    expect(tab.agentName).toBe(AGENT_NAMES[3])
  })

  it('collects every in-use label once per source', () => {
    const used = collectUsedAgentNames({
      tabsByWorktree: {
        [WT_A]: [makeTab({ id: 'a1', worktreeId: WT_A, agentName: 'Juniper' })]
      }
    })
    expect(used).toContain('Juniper')
  })

  it('honors a name chosen before the tab existed', () => {
    const store = createTestStore()
    seedTwoWorktrees(store)

    const tab = store.getState().createTab(WT_A, undefined, undefined, { agentName: 'Cedar' })

    expect(tab).toMatchObject({
      agentName: 'Cedar',
      title: 'Cedar',
      defaultTitle: 'Cedar'
    })
  })

  it('re-names a just-created tab, following labels that still show the picked name', () => {
    const store = createTestStore()
    seedTwoWorktrees(store)
    const { id, agentName } = store.getState().createTab(WT_A)
    const before = store.getState().unifiedTabsByWorktree[WT_A]?.find((t) => t.entityId === id)
    expect(before?.agentName).toBe(agentName)

    store.getState().setTabAgentName(id, 'Juniper')

    const s = store.getState()
    expect(s.tabsByWorktree[WT_A].find((tab) => tab.id === id)).toMatchObject({
      agentName: 'Juniper',
      title: 'Juniper',
      defaultTitle: 'Juniper'
    })
    expect(s.unifiedTabsByWorktree[WT_A]?.find((t) => t.entityId === id)).toMatchObject({
      agentName: 'Juniper'
    })
  })

  it('shows name · topic, then the manual rename, in that precedence', () => {
    const store = createTestStore()
    seedTwoWorktrees(store)
    const { id, agentName } = store.getState().createTab(WT_A)
    const current = () => store.getState().tabsByWorktree[WT_A].find((tab) => tab.id === id)!

    expect(resolveTerminalTabTitle(current(), false)).toBe(agentName)

    store.getState().updateTabTitle(id, 'Fix login bug')
    expect(resolveTerminalTabTitle(current(), false)).toBe(`${agentName} · Fix login bug`)

    store.getState().setTabCustomTitle(id, 'Deploy box')
    expect(resolveTerminalTabTitle(current(), false)).toBe('Deploy box')
  })

  it('survives a save and relaunch, on both the terminal and the unified tab', () => {
    const store = createTestStore()
    seedTwoWorktrees(store)
    const parsed = parseWorkspaceSession({
      activeRepoId: 'repo1',
      activeWorktreeId: WT_A,
      activeTabId: 'tab-named',
      tabsByWorktree: {
        [WT_A]: [
          {
            ...makeTab({ id: 'tab-named', worktreeId: WT_A }),
            agentName: 'Juniper'
          }
        ]
      },
      terminalLayoutsByTabId: { 'tab-named': makeLayout() }
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(parsed.value.tabsByWorktree[WT_A][0].agentName).toBe('Juniper')

    store.getState().hydrateWorkspaceSession(parsed.value)
    store.getState().hydrateTabsSession(parsed.value)

    const s = store.getState()
    expect(s.tabsByWorktree[WT_A][0].agentName).toBe('Juniper')
    expect(
      s.unifiedTabsByWorktree[WT_A]?.find((tab) => tab.entityId === 'tab-named')?.agentName
    ).toBe('Juniper')
  })

  it('names legacy default tabs once on hydration, stable across a second load', () => {
    const session = {
      activeRepoId: 'repo1',
      activeWorktreeId: WT_A,
      activeTabId: 'tab-old',
      tabsByWorktree: {
        [WT_A]: [
          makeTab({ id: 'tab-old', worktreeId: WT_A, defaultTitle: 'Terminal 3' }),
          makeTab({ id: 'tab-typed', worktreeId: WT_A, sortOrder: 1, customTitle: 'Deploy box' }),
          makeTab({ id: 'tab-named', worktreeId: WT_A, sortOrder: 2, agentName: 'Juniper' })
        ]
      },
      terminalLayoutsByTabId: {
        'tab-old': makeLayout(),
        'tab-typed': makeLayout(),
        'tab-named': makeLayout()
      }
    }
    const load = () => {
      const store = createTestStore()
      seedTwoWorktrees(store, {
        boardsByWorktree: {
          [WT_A]: {
            cards: [
              {
                id: 'card-old',
                kind: 'console',
                tabId: 'tab-old',
                agentKind: 'claude',
                title: 'Claude 5'
              },
              {
                id: 'card-typed-title',
                kind: 'console',
                tabId: 'tab-named',
                agentKind: 'claude',
                title: 'Payments'
              }
            ]
          }
        } as unknown as AppState['boardsByWorktree'],
        boardsHydrated: true
      })
      store.getState().hydrateWorkspaceSession(session)
      store.getState().hydrateTabsSession(session)
      return store.getState()
    }

    const first = load()
    const byId = (id: string) => first.tabsByWorktree[WT_A].find((tab) => tab.id === id)!
    const newName = byId('tab-old').agentName
    expect(newName && AGENT_NAMES.includes(newName)).toBe(true)
    expect(newName).not.toBe('Juniper')
    expect(byId('tab-typed').agentName).toBeUndefined()
    expect(byId('tab-typed').customTitle).toBe('Deploy box')
    expect(byId('tab-named').agentName).toBe('Juniper')
    expect(
      first.unifiedTabsByWorktree[WT_A]?.find((tab) => tab.entityId === 'tab-old')?.agentName
    ).toBe(newName)
    const cards = first.boardsByWorktree[WT_A].cards
    expect(cards.find((card) => card.id === 'card-old')?.title).toBe(newName)
    expect(cards.find((card) => card.id === 'card-typed-title')?.title).toBe('Payments')

    const second = load()
    expect(second.tabsByWorktree[WT_A].find((tab) => tab.id === 'tab-old')?.agentName).toBe(
      newName
    )
    expect(
      second.boardsByWorktree[WT_A].cards.find((card) => card.id === 'card-old')?.title
    ).toBe(newName)
  })

  it('keeps a name already persisted on a reload', () => {
    const store = createTestStore()
    seedTwoWorktrees(store)
    const session = {
      activeRepoId: 'repo1',
      activeWorktreeId: WT_A,
      activeTabId: 'tab-old',
      tabsByWorktree: {
        [WT_A]: [makeTab({ id: 'tab-old', worktreeId: WT_A, agentName: 'Cedar' })]
      },
      terminalLayoutsByTabId: { 'tab-old': makeLayout() }
    }
    store.getState().hydrateWorkspaceSession(session)
    expect(store.getState().tabsByWorktree[WT_A][0].agentName).toBe('Cedar')
  })
})
