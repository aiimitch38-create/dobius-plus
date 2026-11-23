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

  it('keeps existing unnamed tabs unnamed after hydration', () => {
    const store = createTestStore()
    seedTwoWorktrees(store)

    store.getState().hydrateWorkspaceSession({
      activeRepoId: 'repo1',
      activeWorktreeId: WT_A,
      activeTabId: 'tab-old',
      tabsByWorktree: {
        [WT_A]: [makeTab({ id: 'tab-old', worktreeId: WT_A })]
      },
      terminalLayoutsByTabId: { 'tab-old': makeLayout() }
    })

    expect(store.getState().tabsByWorktree[WT_A][0].agentName).toBeUndefined()
  })
})
