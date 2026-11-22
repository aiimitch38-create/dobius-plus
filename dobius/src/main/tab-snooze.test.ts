import { describe, expect, it } from 'vitest'
import type { AgentResumeOwner } from '../shared/agent-resume-owner'
import type { SleepingAgentSessionRecord } from '../shared/agent-session-resume'
import type { SnoozedTabEntry, SnoozeTabRequest } from '../shared/tab-snooze-types'
import {
  MAX_SNOOZED_TABS,
  cleanSnoozedTabEntries,
  cleanSnoozedTabEntry,
  dueSnoozedTabs,
  nextSnoozeDelay
} from '../shared/tab-snooze-types'
import { createTabSnoozeService } from './tab-snooze'

const LEAF = '11111111-1111-4111-8111-111111111111'

function agentSession(tabId: string, worktreeId = 'wt-1'): SleepingAgentSessionRecord {
  const paneKey = `${tabId}:${LEAF}`
  const providerSession = { key: 'session_id' as const, id: `session-${tabId}` }
  return {
    paneKey,
    tabId,
    worktreeId,
    agent: 'claude',
    providerSession,
    prompt: 'fix the login bug',
    state: 'done',
    capturedAt: 900,
    updatedAt: 800,
    connectionId: null,
    origin: 'worktree-sleep',
    resumeOwner: {
      authority: { kind: 'local' },
      worktreeId,
      tabId,
      leafId: LEAF,
      paneKey,
      ptyId: `pty-${tabId}`,
      launchToken: `launch-${tabId}`,
      agent: 'claude',
      providerSession
    }
  }
}

function request(tabId: string, extra: Partial<SnoozeTabRequest> = {}): SnoozeTabRequest {
  return { worktreeId: 'wt-1', tabId, title: 'Fix', until: null, ...extra }
}

function harness(options: { verifyResumeOwner?: (owner: AgentResumeOwner) => boolean } = {}) {
  const state = { saved: [] as unknown, clock: 1000, changes: 0 }
  const files = new Map<string, string>()
  const service = createTabSnoozeService({
    load: () => state.saved,
    save: (entries) => {
      state.saved = entries
    },
    scrollback: {
      write: (key, buffer) => {
        const ref = `v1-${Buffer.from(key).toString('hex').padEnd(32, '0').slice(0, 32)}`
        files.set(ref, buffer)
        return ref
      },
      read: (ref) => files.get(ref) ?? null,
      remove: (ref) => {
        files.delete(ref)
      }
    },
    onChange: () => {
      state.changes += 1
    },
    now: () => state.clock,
    ...options
  })
  return { service, state, files }
}

describe('cleanSnoozedTabEntry', () => {
  it('keeps only safe fields', () => {
    const entry = cleanSnoozedTabEntry({
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      title: 'x'.repeat(300),
      until: 5,
      viewMode: 'nope',
      color: 'javascript:alert(1)',
      extra: 1
    })
    expect(entry?.title.length).toBe(100)
    expect(entry?.until).toBe(5)
    expect(entry?.viewMode).toBeUndefined()
    expect(entry?.color).toBeUndefined()
    expect(entry && 'extra' in entry).toBe(false)
    expect(cleanSnoozedTabEntry({ worktreeId: 'wt-1' })).toBeNull()
    expect(cleanSnoozedTabEntry({ worktreeId: 'wt-1', tabId: 'pane:key' })).toBeNull()
    expect(cleanSnoozedTabEntry({ worktreeId: 'wt\n1', tabId: 'tab-1' })).toBeNull()
  })

  it('drops a conversation that belongs to another tab or worktree', () => {
    const base = { worktreeId: 'wt-1', tabId: 'tab-1' }
    expect(
      cleanSnoozedTabEntry({ ...base, agentSession: agentSession('tab-1') })?.agentSession
        ?.resumeOwner?.ptyId
    ).toBe('pty-tab-1')
    expect(
      cleanSnoozedTabEntry({ ...base, agentSession: agentSession('tab-2') })?.agentSession
    ).toBeUndefined()
    expect(
      cleanSnoozedTabEntry({ ...base, agentSession: agentSession('tab-1', 'wt-2') })?.agentSession
    ).toBeUndefined()
  })

  it('a pinned tab comes back pinned; anything but true is dropped', () => {
    const base = { worktreeId: 'wt-1', tabId: 'tab-1' }
    expect(cleanSnoozedTabEntry({ ...base, pinned: true })?.pinned).toBe(true)
    expect(cleanSnoozedTabEntry({ ...base, pinned: 'yes' })?.pinned).toBeUndefined()
  })

  it('keeps one row per worktree + tab and caps the list', () => {
    const rows = [
      { worktreeId: 'wt-1', tabId: 'tab-1', title: 'old' },
      { worktreeId: 'wt-1', tabId: 'tab-1', title: 'new' },
      { worktreeId: 'wt-2', tabId: 'tab-1', title: 'other worktree' },
      'junk'
    ]
    expect(cleanSnoozedTabEntries(rows).map((entry) => entry.title)).toEqual([
      'new',
      'other worktree'
    ])
    const many = Array.from({ length: MAX_SNOOZED_TABS + 5 }, (_, index) => ({
      worktreeId: 'wt-1',
      tabId: `tab-${index}`
    }))
    expect(cleanSnoozedTabEntries(many)).toHaveLength(MAX_SNOOZED_TABS)
  })
})

describe('snooze timing', () => {
  it('finds due entries and the next delay, capped at six hours', () => {
    const list = [
      { id: 'a', until: 100, ready: false },
      { id: 'b', until: 50, ready: true },
      { id: 'c', until: null, ready: false },
      { id: 'd', until: 300, ready: false },
      { id: 'e', until: 10, ready: false, returning: true as const }
    ]
    expect(dueSnoozedTabs(list, 100).map((entry) => entry.id)).toEqual(['a'])
    expect(nextSnoozeDelay(list, 90)).toBe(10)
    expect(nextSnoozeDelay(list, 500)).toBe(0)
    expect(nextSnoozeDelay([{ until: 1e15, ready: false }], 0)).toBe(6 * 3600e3)
    expect(nextSnoozeDelay([{ until: null, ready: false }], 0)).toBeNull()
  })
})

describe('tab snooze service', () => {
  it('adds an entry keyed by worktree + tab and keeps its output in the snapshot store', () => {
    const h = harness()
    const result = h.service.add(request('tab-1', { until: 5000, scrollback: 'one\r\ntwo' }))
    expect(result.ok).toBe(true)
    const [entry] = h.service.list()
    expect(entry).toMatchObject({ worktreeId: 'wt-1', tabId: 'tab-1', ready: false, until: 5000 })
    expect(entry.scrollbackRef && h.files.get(entry.scrollbackRef)).toBe('one\r\ntwo')
    // Same tab id in another worktree is a different entry; same pair replaces.
    h.service.add(request('tab-1', { worktreeId: 'wt-2' }))
    h.service.add(request('tab-1', { title: 'Renamed' }))
    expect(h.service.list().map((row) => `${row.worktreeId}/${row.title}`)).toEqual([
      'wt-2/Fix',
      'wt-1/Renamed'
    ])
    expect(h.files.size).toBe(0)
    h.service.stop()
  })

  it('hands a timed return out once (take)', () => {
    const h = harness()
    h.service.add(request('tab-1', { until: 500, scrollback: 'output' })) // already due
    expect(h.service.list()[0].ready).toBe(true)
    const ref = { worktreeId: 'wt-1', tabId: 'tab-1' }
    const got = h.service.take(ref, { onlyReady: true, returnTabId: 'tab-new' })
    expect(got?.scrollback).toBe('output')
    expect(got?.entry).toMatchObject({ returning: true, returnTabId: 'tab-new' })
    // A second window asking gets nothing, with or without onlyReady.
    expect(h.service.take(ref, { onlyReady: true })).toBeNull()
    expect(h.service.take(ref)).toBeNull()
    // It stays in the list until the reopened tab has started, then it is gone.
    expect(h.service.list()).toHaveLength(1)
    expect(h.service.settle(ref)).toBe(true)
    expect(h.service.list()).toEqual([])
    expect(h.files.size).toBe(0)
    expect(h.service.settle(ref)).toBe(false)
    h.service.stop()
  })

  it('take onlyReady never takes an entry snoozed again meanwhile', () => {
    const h = harness()
    const ref = { worktreeId: 'wt-1', tabId: 'tab-1' }
    h.service.add(request('tab-1', { until: 500 }))
    h.service.setTime(ref, 99999) // snoozed again from another window
    expect(h.service.take(ref, { onlyReady: true })).toBeNull()
    expect(h.service.list()[0].returning).toBeUndefined()
    // Bring back now takes it whatever its state.
    expect(h.service.take(ref)?.entry.tabId).toBe('tab-1')
    h.service.stop()
  })

  it('checkDue turns due entries ready and tells the windows once', () => {
    const h = harness()
    h.service.add(request('tab-a', { until: 2000 }))
    h.service.add(request('tab-b', { until: null }))
    const before = h.state.changes
    h.state.clock = 2000
    h.service.checkDue()
    const byTab = Object.fromEntries(h.service.list().map((entry) => [entry.tabId, entry]))
    expect(byTab['tab-a'].ready).toBe(true)
    expect(byTab['tab-b'].ready).toBe(false)
    expect(h.state.changes).toBe(before + 1)
    h.service.checkDue() // nothing new: no broadcast
    expect(h.state.changes).toBe(before + 1)
    h.service.stop()
  })

  it('setTime: now makes it ready, later or manual does not; discard removes', () => {
    const h = harness()
    const ref = { worktreeId: 'wt-1', tabId: 'tab-1' }
    h.service.add(request('tab-1', { until: 9000, scrollback: 'x' }))
    h.service.setTime(ref, 1000)
    expect(h.service.list()[0].ready).toBe(true)
    h.service.setTime(ref, null)
    expect(h.service.list()[0].ready).toBe(false)
    expect(h.service.setTime({ worktreeId: 'wt-1', tabId: 'missing' }, 1)).toBe(false)
    expect(h.service.discard(ref)).toBe(true)
    expect(h.service.list()).toEqual([])
    expect(h.files.size).toBe(0)
    h.service.stop()
  })

  it('holds at most 100 entries', () => {
    const h = harness()
    for (let index = 0; index < MAX_SNOOZED_TABS; index += 1) {
      expect(h.service.add(request(`tab-${index}`)).ok).toBe(true)
    }
    expect(h.service.add(request('tab-extra'))).toEqual({ ok: false, reason: 'full' })
    // Snoozing a tab that is already on the shelf replaces it, even when full.
    expect(h.service.add(request('tab-0', { title: 'Again' })).ok).toBe(true)
    expect(h.service.list()).toHaveLength(MAX_SNOOZED_TABS)
    h.service.stop()
  })

  it('keeps the conversation only when main can vouch for its owner', () => {
    const trusted = harness({ verifyResumeOwner: () => true })
    const session = agentSession('tab-1')
    expect(trusted.service.add(request('tab-1', { agentSession: session })).ok).toBe(true)
    trusted.service.stop()

    const untrusted = harness({ verifyResumeOwner: () => false })
    expect(untrusted.service.add(request('tab-1', { agentSession: session }))).toEqual({
      ok: false,
      reason: 'conversation-not-resumable'
    })
    const { resumeOwner: _owner, ...ownerless } = session
    expect(untrusted.service.add(request('tab-1', { agentSession: ownerless }))).toEqual({
      ok: false,
      reason: 'conversation-not-resumable'
    })
    expect(untrusted.service.list()).toEqual([])
    untrusted.service.stop()
  })

  it('vouches for the owner only for the window that took the entry, until it settles', () => {
    const h = harness({ verifyResumeOwner: () => true })
    const session = agentSession('tab-1')
    const owner = session.resumeOwner as AgentResumeOwner
    const ref = { worktreeId: 'wt-1', tabId: 'tab-1' }
    h.service.add(request('tab-1', { agentSession: session }))
    // On the shelf: nobody may claim the conversation.
    expect(h.service.ownsReturn(owner, 7)).toBe(false)
    h.service.take(ref, { rendererId: 7 })
    expect(h.service.ownsReturn(owner, 7)).toBe(true)
    expect(h.service.ownsReturn(owner, 8)).toBe(false)
    expect(h.service.ownsReturn({ ...owner, ptyId: 'pty-other' }, 7)).toBe(false)
    // A terminal starting is not enough: only the confirmed conversation settles it.
    expect(h.service.settle(ref, 7)).toBe(false)
    expect(h.service.settleReturn({ ...owner, ptyId: 'pty-other' })).toBe(false)
    expect(h.service.list()).toHaveLength(1)
    expect(h.service.settleReturn(owner)).toBe(true)
    expect(h.service.list()).toEqual([])
    expect(h.service.ownsReturn(owner, 7)).toBe(false)
    h.service.stop()
  })

  it('only the window that took an entry can settle it or put it back', () => {
    const h = harness()
    const ref = { worktreeId: 'wt-1', tabId: 'tab-1' }
    h.service.add(request('tab-1'))
    h.service.take(ref, { rendererId: 7 })
    expect(h.service.settle(ref, 8)).toBe(false)
    expect(h.service.putBack(ref, 8)).toBe(false)
    expect(h.service.settle(ref, 7)).toBe(true)
    expect(h.service.list()).toEqual([])
    h.service.stop()
  })

  it('a window that goes away mid-return gives its entries back to the shelf', () => {
    const h = harness()
    h.service.add(request('tab-1', { until: 500, scrollback: 'out' }))
    h.service.add(request('tab-2'))
    h.service.take({ worktreeId: 'wt-1', tabId: 'tab-1' }, { rendererId: 7 })
    h.service.take({ worktreeId: 'wt-1', tabId: 'tab-2' }, { rendererId: 8 })
    h.service.releaseRenderer(7)
    const [first, second] = h.service.list()
    expect(first).toMatchObject({ tabId: 'tab-1', until: null, ready: false })
    expect(first.returning).toBeUndefined()
    expect(second.returning).toBe(true)
    expect(h.service.take({ worktreeId: 'wt-1', tabId: 'tab-1' })?.scrollback).toBe('out')
    h.service.stop()
  })

  it('a removed worktree takes its entries and their output with it', () => {
    const h = harness()
    h.service.add(request('tab-1', { until: 5000, scrollback: 'gone' }))
    h.service.add(request('tab-2', { worktreeId: 'wt-2', until: 9000, scrollback: 'kept' }))
    const changes = h.state.changes
    expect(h.service.discardWorktree('wt-1')).toBe(true)
    expect(h.service.list().map((entry) => entry.worktreeId)).toEqual(['wt-2'])
    expect([...h.files.values()]).toEqual(['kept'])
    expect(h.state.changes).toBe(changes + 1)
    expect(h.service.discardWorktree('wt-1')).toBe(false)
    h.service.stop()
  })

  it('a failed return goes back on the shelf with its conversation', () => {
    const h = harness({ verifyResumeOwner: () => true })
    const ref = { worktreeId: 'wt-1', tabId: 'tab-1' }
    h.service.add(
      request('tab-1', { until: 500, agentSession: agentSession('tab-1'), scrollback: 'out' })
    )
    h.service.take(ref, { onlyReady: true })
    expect(h.service.putBack(ref)).toBe(true)
    const [entry] = h.service.list() as SnoozedTabEntry[]
    expect(entry).toMatchObject({ until: null, ready: false })
    expect(entry.returning).toBeUndefined()
    expect(entry.agentSession?.providerSession.id).toBe('session-tab-1')
    expect(h.service.take(ref)?.scrollback).toBe('out')
    h.service.stop()
  })

  it('a return cut short by a quit starts over at the next launch', () => {
    const h = harness()
    const ref = { worktreeId: 'wt-1', tabId: 'tab-1' }
    h.service.add(request('tab-1'))
    h.service.take(ref, { returnTabId: 'tab-new' })
    h.service.recoverInterruptedReturns()
    const [entry] = h.service.list()
    expect(entry).toMatchObject({ ready: true, returnTabId: 'tab-new' })
    expect(entry.returning).toBeUndefined()
    // The retry reuses the tab the first attempt made.
    expect(h.service.take(ref, { returnTabId: 'tab-other' })?.entry.returnTabId).toBe('tab-new')
    h.service.stop()
  })

  it('never trusts returning or a scrollback ref supplied with a request', () => {
    const h = harness()
    h.service.add({
      ...request('tab-1'),
      returning: true,
      returnTabId: 'tab-x',
      scrollbackRef: `v1-${'a'.repeat(32)}`
    } as SnoozeTabRequest)
    const [entry] = h.service.list()
    expect(entry.returning).toBeUndefined()
    expect(entry.returnTabId).toBeUndefined()
    expect(entry.scrollbackRef).toBeUndefined()
    h.service.stop()
  })
})
