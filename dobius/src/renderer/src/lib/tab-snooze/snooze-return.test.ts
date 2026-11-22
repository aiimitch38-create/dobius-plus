import { describe, expect, it, vi } from 'vitest'
import type { SnoozedTabEntry } from '../../../../shared/tab-snooze-types'
import { createSerialLook, runSnoozeReturnLook, settleReturningSnoozedTabs } from './snooze-return'

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
  function harness(tab: { id: string; ptyId: string | null } | null, ptyIds: string[] = []) {
    const untrack = vi.fn()
    const settle = vi.fn(async () => true)
    const release = vi.fn(async () => true)
    settleReturningSnoozedTabs({
      getState: () =>
        ({
          returningSnoozedTabs: { 'tab-new': { ref: REF, claim: { token: 'token-1', owner } } },
          tabsByWorktree: { 'wt-1': tab ? [tab] : [] },
          ptyIdsByTabId: { 'tab-new': ptyIds },
          untrackReturningSnoozedTab: untrack
        }) as never,
      api: { settle },
      releaseAgentResume: release
    })
    return { untrack, settle, release }
  }

  it('keeps the entry in main until the reopened tab’s terminal has started', () => {
    const waiting = harness({ id: 'tab-new', ptyId: null })
    expect(waiting.settle).not.toHaveBeenCalled()
    expect(waiting.untrack).not.toHaveBeenCalled()

    const started = harness({ id: 'tab-new', ptyId: 'pty-1' })
    expect(started.settle).toHaveBeenCalledWith(REF)
    expect(started.untrack).toHaveBeenCalledWith('tab-new')
    expect(started.release).not.toHaveBeenCalled()

    expect(harness({ id: 'tab-new', ptyId: null }, ['pty-2']).settle).toHaveBeenCalledWith(REF)
  })

  it('a tab closed before it started is done, and gives its session claim back', () => {
    const closed = harness(null)
    expect(closed.settle).toHaveBeenCalledWith(REF)
    expect(closed.release).toHaveBeenCalledWith('token-1', owner)
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
