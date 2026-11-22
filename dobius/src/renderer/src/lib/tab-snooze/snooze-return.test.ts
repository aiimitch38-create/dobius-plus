import { describe, expect, it, vi } from 'vitest'
import type { SnoozedTabEntry } from '../../../../shared/tab-snooze-types'
import {
  closeInterruptedSnoozeReturnTabs,
  createSerialLook,
  runSnoozeReturnLook,
  settleReturningSnoozedTabs
} from './snooze-return'

const REF = { worktreeId: 'wt-1', tabId: 'tab-old' }
const owner = { paneKey: 'p' } as never

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

describe('settleReturningSnoozedTabs', () => {
  function harness(
    tab: { id: string; ptyId: string | null } | null,
    options: { ptyIds?: string[]; conversation?: boolean } = {}
  ) {
    const untrack = vi.fn()
    const settle = vi.fn(async () => true)
    const putBack = vi.fn(async () => true)
    const release = vi.fn(async () => true)
    settleReturningSnoozedTabs({
      getState: () =>
        ({
          returningSnoozedTabs: {
            'tab-new': {
              ref: REF,
              ...(options.conversation === false ? {} : { claim: { token: 'token-1', owner } })
            }
          },
          tabsByWorktree: { 'wt-1': tab ? [tab] : [] },
          ptyIdsByTabId: { 'tab-new': options.ptyIds ?? [] },
          untrackReturningSnoozedTab: untrack
        }) as never,
      api: { settle, putBack },
      releaseAgentResume: release
    })
    return { untrack, settle, putBack, release }
  }

  it('a plain tab is done once its terminal has started, and not before', () => {
    const waiting = harness({ id: 'tab-new', ptyId: null }, { conversation: false })
    expect(waiting.settle).not.toHaveBeenCalled()
    expect(waiting.untrack).not.toHaveBeenCalled()

    const started = harness({ id: 'tab-new', ptyId: 'pty-1' }, { conversation: false })
    expect(started.settle).toHaveBeenCalledWith(REF)
    expect(started.untrack).toHaveBeenCalledWith('tab-new')

    expect(
      harness({ id: 'tab-new', ptyId: null }, { conversation: false, ptyIds: ['pty-2'] }).settle
    ).toHaveBeenCalledWith(REF)
  })

  it('a conversation is never settled from here: a started terminal is not proof', () => {
    const started = harness({ id: 'tab-new', ptyId: 'pty-1' })
    expect(started.settle).not.toHaveBeenCalled()
    // Main already dropped the entry if it started the conversation; if it did
    // not, this is what puts the entry back where the user can see it.
    expect(started.putBack).toHaveBeenCalledWith(REF)
    expect(started.untrack).toHaveBeenCalledWith('tab-new')
    expect(started.release).not.toHaveBeenCalled()
  })

  it('a conversation tab closed before it started goes back on the shelf, claim released', () => {
    const closed = harness(null)
    expect(closed.settle).not.toHaveBeenCalled()
    expect(closed.putBack).toHaveBeenCalledWith(REF)
    expect(closed.release).toHaveBeenCalledWith('token-1', owner)
  })
})

describe('closeInterruptedSnoozeReturnTabs', () => {
  it('closes the tab an unfinished return left behind, before any terminal mounts in it', () => {
    const closeTab = vi.fn()
    const closed = closeInterruptedSnoozeReturnTabs({
      entries: [
        entry('tab-a', { returnTabId: 'tab-left', ready: true }),
        // Another window is bringing this one back right now.
        entry('tab-b', { returnTabId: 'tab-busy', returning: true }),
        // Chosen id, but the tab was never made.
        entry('tab-c', { returnTabId: 'tab-never' }),
        entry('tab-d')
      ],
      getState: () =>
        ({
          tabsByWorktree: {
            'wt-1': [{ id: 'tab-left' }, { id: 'tab-busy' }, { id: 'tab-keep' }]
          }
        }) as never,
      closeTab
    })
    expect(closed).toEqual(['tab-left'])
    expect(closeTab.mock.calls).toEqual([['tab-left']])
  })
})

describe('runSnoozeReturnLook', () => {
  it('waits for the tabs to be restored, then runs queued bring-backs before timed returns', async () => {
    const queued = [{ worktreeId: 'wt-1', tabId: 'tab-queued' }]
    const state = {
      workspaceSessionReady: false,
      snoozedTabs: [
        entry('tab-due', { ready: true }),
        entry('tab-later'),
        entry('tab-returning', { ready: true, returning: true })
      ],
      drainSnoozeBringBacks: () => queued.splice(0)
    }
    const bringBack = vi.fn(async () => 'returned')
    await runSnoozeReturnLook({ getState: () => state, bringBack })
    expect(bringBack).not.toHaveBeenCalled()
    expect(queued).toHaveLength(1)

    state.workspaceSessionReady = true
    await runSnoozeReturnLook({ getState: () => state, bringBack })
    expect(bringBack.mock.calls).toEqual([
      [{ worktreeId: 'wt-1', tabId: 'tab-queued' }, {}],
      [{ worktreeId: 'wt-1', tabId: 'tab-due' }, { onlyReady: true }]
    ])
  })
})

describe('createSerialLook', () => {
  it('runs one look at a time and one more for requests made meanwhile', async () => {
    let release: () => void = () => {}
    let runs = 0
    const look = createSerialLook(
      () =>
        new Promise<void>((resolve) => {
          runs += 1
          release = resolve
        })
    )
    look()
    look()
    look()
    expect(runs).toBe(1)
    release()
    await vi.waitFor(() => expect(runs).toBe(2))
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runs).toBe(2)
  })
})
