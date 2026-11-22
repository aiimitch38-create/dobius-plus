import { create } from 'zustand'
import { describe, expect, it } from 'vitest'
import type { SnoozedTabEntry } from '../../../../shared/tab-snooze-types'
import type { AppState } from '../types'
import type { TabSnoozeSlice } from './tab-snooze'
import { createTabSnoozeSlice, selectSnoozedTabsForWorktree } from './tab-snooze'

function makeStore() {
  return create<Pick<AppState, keyof TabSnoozeSlice>>()((...args) =>
    createTabSnoozeSlice(...(args as Parameters<typeof createTabSnoozeSlice>))
  )
}

function entry(tabId: string, extra: Partial<SnoozedTabEntry> = {}): SnoozedTabEntry {
  return {
    worktreeId: 'wt-1',
    tabId,
    title: tabId,
    snoozedAt: 1,
    until: null,
    ready: false,
    ...extra
  }
}

describe('createTabSnoozeSlice', () => {
  it('keeps the shelf folded by default and remembers which ones were opened', () => {
    const store = makeStore()
    expect(store.getState().snoozedShelfOpenWorktreeIds).toEqual([])
    store.getState().toggleSnoozedShelf('wt-1')
    store.getState().toggleSnoozedShelf('wt-2')
    store.getState().toggleSnoozedShelf('wt-1')
    expect(store.getState().snoozedShelfOpenWorktreeIds).toEqual(['wt-2'])
    store.getState().setSnoozedShelfOpenWorktreeIds(['wt-3', 'wt-3'])
    expect(store.getState().snoozedShelfOpenWorktreeIds).toEqual(['wt-3'])
  })

  it('queues a bring-back asked for before the tabs are restored, once per tab', () => {
    const store = makeStore()
    const ref = { worktreeId: 'wt-1', tabId: 'tab-1' }
    store.getState().queueSnoozeBringBack(ref)
    store.getState().queueSnoozeBringBack({ ...ref })
    store.getState().queueSnoozeBringBack({ worktreeId: 'wt-2', tabId: 'tab-1' })
    expect(store.getState().drainSnoozeBringBacks()).toHaveLength(2)
    expect(store.getState().drainSnoozeBringBacks()).toEqual([])
  })

  it('tracks a reopened tab until its terminal starts', () => {
    const store = makeStore()
    const ref = { worktreeId: 'wt-1', tabId: 'tab-1' }
    store.getState().trackReturningSnoozedTab('tab-new', { ref })
    expect(store.getState().returningSnoozedTabs['tab-new']).toEqual({ ref })
    const before = store.getState()
    store.getState().untrackReturningSnoozedTab('tab-missing')
    expect(store.getState()).toBe(before)
    store.getState().untrackReturningSnoozedTab('tab-new')
    expect(store.getState().returningSnoozedTabs).toEqual({})
  })
})

describe('selectSnoozedTabsForWorktree', () => {
  it('lists a worktree’s own rows, soonest first, manual ones last', () => {
    const state = {
      snoozedTabs: [
        entry('manual'),
        entry('later', { until: 900 }),
        entry('sooner', { until: 100 }),
        entry('other', { worktreeId: 'wt-2', until: 1 })
      ],
      tabsByWorktree: {}
    }
    expect(selectSnoozedTabsForWorktree(state, 'wt-1').map((row) => row.tabId)).toEqual([
      'sooner',
      'later',
      'manual'
    ])
  })

  it('hides a tab that is still open and one that is on its way back', () => {
    const state = {
      snoozedTabs: [entry('leaving'), entry('returning', { returning: true }), entry('snoozed')],
      tabsByWorktree: { 'wt-1': [{ id: 'leaving' }] }
    }
    expect(selectSnoozedTabsForWorktree(state, 'wt-1').map((row) => row.tabId)).toEqual(['snoozed'])
    // Once the tab has really closed, its row appears.
    expect(
      selectSnoozedTabsForWorktree({ ...state, tabsByWorktree: {} }, 'wt-1').map((row) => row.tabId)
    ).toEqual(['leaving', 'snoozed'])
  })
})
