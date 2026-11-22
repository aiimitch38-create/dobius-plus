// Snoozed tabs. Snoozing closes a tab (its terminal stops, so it costs no
// memory) and keeps what is needed to bring it back: title, worktree, pin, and
// the agent conversation it was on. When its time comes the entry turns
// `ready` and the worktree's window takes it back.
//
// Main owns the list so one timer serves every window, and `take` is the one
// place an entry leaves: two windows asking at once get it once.
//
// Bounded by construction: at most MAX_SNOOZED_TABS entries (metadata only),
// each with at most one scrollback snapshot, and one timer armed for the
// earliest wake and never further out than SNOOZE_TIMER_MAX_MS.
import type { AgentResumeOwner } from '../shared/agent-resume-owner'
import { getAgentResumeOwnerFingerprint } from '../shared/agent-resume-owner'
import type {
  SnoozedTabEntry,
  SnoozedTabRef,
  SnoozeTabRequest,
  SnoozeTabResult,
  TakenSnoozedTab
} from '../shared/tab-snooze-types'
import {
  MAX_SNOOZED_TABS,
  cleanSnoozedTabEntries,
  cleanSnoozedTabEntry,
  dueSnoozedTabs,
  nextSnoozeDelay,
  sameSnoozedTab,
  snoozedTabKey
} from '../shared/tab-snooze-types'

export type { TabSnoozeDeps, TabSnoozeScrollbackStore } from './tab-snooze-deps'

import type { TabSnoozeDeps } from './tab-snooze-deps'

export type TabSnoozeService = ReturnType<typeof createTabSnoozeService>

export function createTabSnoozeService(deps: TabSnoozeDeps) {
  const now = deps.now ?? Date.now
  let timer: ReturnType<typeof setTimeout> | null = null
  // Which window (webContents id) is bringing each `returning` entry back.
  // In memory only: after a relaunch no window holds one, and
  // recoverInterruptedReturns() starts those returns over.
  const reservedBy = new Map<string, number>()
  // Returns the user called off while main was starting their terminal; the
  // spawn's completion (stageReturnSettle) reads this and undoes itself.
  const cancelled = new Set<string>()
  const read = (): SnoozedTabEntry[] => cleanSnoozedTabEntries(deps.load())
  const find = (ref: SnoozedTabRef): { entries: SnoozedTabEntry[]; entry?: SnoozedTabEntry } => {
    const entries = read()
    return { entries, entry: entries.find((existing) => sameSnoozedTab(existing, ref)) }
  }
  /** True when `rendererId` may finish or undo this return (no id: main itself). */
  const holds = (entry: SnoozedTabEntry | undefined, rendererId?: number): boolean =>
    Boolean(entry?.returning) &&
    (rendererId === undefined || reservedBy.get(snoozedTabKey(entry!)) === rendererId)
  // Why not SSH: there the spawn only makes a remote shell and the renderer
  // types the resume command afterwards, so main can never confirm that the
  // conversation started. Same reason hibernation leaves SSH agents alone.
  const ownsConversation = (entry: SnoozedTabEntry, owner: AgentResumeOwner): boolean =>
    Boolean(entry.agentSession?.resumeOwner) &&
    owner.authority.kind !== 'ssh' &&
    getAgentResumeOwnerFingerprint(entry.agentSession!.resumeOwner!) ===
      getAgentResumeOwnerFingerprint(owner)

  function arm(): void {
    if (timer) {
      clearTimeout(timer)
    }
    timer = null
    const delay = nextSnoozeDelay(read(), now())
    if (delay === null) {
      return
    }
    timer = setTimeout(checkDue, delay)
    timer.unref?.()
  }

  function changed(): void {
    arm()
    try {
      deps.onChange()
    } catch (err) {
      console.warn('[tab-snooze] change listener failed:', err instanceof Error ? err.message : err)
    }
  }

  /** Due entries turn ready; then the timer is armed for the next one. */
  function checkDue(): void {
    const entries = read()
    const due = new Set(dueSnoozedTabs(entries, now()).map(snoozedTabKey))
    if (due.size === 0) {
      arm()
      return
    }
    deps.save(
      entries.map((entry) => (due.has(snoozedTabKey(entry)) ? { ...entry, ready: true } : entry))
    )
    changed()
  }

  function insert(entry: SnoozedTabEntry, scrollback: string | null | undefined): SnoozedTabEntry {
    const key = snoozedTabKey(entry)
    reservedBy.delete(key)
    const kept = read().filter((existing) => {
      if (!sameSnoozedTab(existing, entry)) {
        return true
      }
      if (existing.scrollbackRef) {
        deps.scrollback.remove(existing.scrollbackRef)
      }
      return false
    })
    const { scrollbackRef: _stale, ...withoutRef } = entry
    const ref = scrollback ? deps.scrollback.write(key, scrollback) : null
    const stored: SnoozedTabEntry = ref ? { ...withoutRef, scrollbackRef: ref } : withoutRef
    deps.save([...kept, stored])
    changed()
    return stored
  }

  /** Drops entries for good, with their saved output. */
  function remove(entries: SnoozedTabEntry[], gone: SnoozedTabEntry[]): boolean {
    if (gone.length === 0) {
      return false
    }
    deps.save(entries.filter((existing) => !gone.includes(existing)))
    for (const entry of gone) {
      reservedBy.delete(snoozedTabKey(entry))
      cancelled.delete(snoozedTabKey(entry))
      if (entry.scrollbackRef) {
        deps.scrollback.remove(entry.scrollbackRef)
      }
    }
    changed()
    return true
  }

  /** Returns that did not finish: back on the shelf until the user brings them back. */
  function shelve(entries: SnoozedTabEntry[], back: SnoozedTabEntry[], ready = false): boolean {
    if (back.length === 0) {
      return false
    }
    deps.save(
      entries.map((existing) => {
        if (!back.includes(existing)) {
          return existing
        }
        reservedBy.delete(snoozedTabKey(existing))
        cancelled.delete(snoozedTabKey(existing))
        const { returning: _returning, ...rest } = existing
        // `ready`: a return cut short by a quit starts over by itself.
        return ready ? { ...rest, ready } : { ...rest, until: null, ready }
      })
    )
    changed()
    return true
  }

  return {
    list: read,
    checkDue,
    start: arm,
    stop(): void {
      if (timer) {
        clearTimeout(timer)
      }
      timer = null
    },

    /** Adds an entry, replacing one for the same worktree + tab. */
    add(request: SnoozeTabRequest): SnoozeTabResult {
      const until = Number.isFinite(request?.until) ? (request.until as number) : null
      const entry = cleanSnoozedTabEntry({
        ...request,
        snoozedAt: now(),
        until,
        ready: until != null && until <= now(),
        scrollbackRef: undefined,
        returning: undefined,
        returnTabId: undefined
      })
      if (!entry) {
        return { ok: false, reason: 'invalid' }
      }
      const entries = read()
      const replaces = entries.some((existing) => sameSnoozedTab(existing, entry))
      if (!replaces && entries.length >= MAX_SNOOZED_TABS) {
        return { ok: false, reason: 'full' }
      }
      if (request.agentSession) {
        // Why refuse instead of dropping the session: without an owner main
        // can vouch for, the tab could only come back as a plain shell.
        const owner = entry.agentSession?.resumeOwner
        if (!owner || owner.authority.kind === 'ssh' || deps.verifyResumeOwner?.(owner) === false) {
          return { ok: false, reason: 'conversation-not-resumable' }
        }
      }
      const scrollback = typeof request.scrollback === 'string' ? request.scrollback : null
      return { ok: true, entry: insert(entry, scrollback) }
    },

    /**
     * Hands an entry to the window that is reopening it; null if another
     * caller got it first. The entry stays in the list as `returning` (off the
     * shelf, never handed out twice) until settle() confirms the tab started.
     * `onlyReady`: null unless it is still ready (a window returning due tabs
     * from a list it read a moment ago, during which the entry may have been
     * snoozed again).
     */
    take(
      ref: SnoozedTabRef,
      options: { onlyReady?: boolean; returnTabId?: string; rendererId?: number } = {}
    ): TakenSnoozedTab | null {
      const { entries, entry } = find(ref)
      if (!entry || entry.returning || (options.onlyReady && !entry.ready)) {
        return null
      }
      const taken = cleanSnoozedTabEntry({
        ...entry,
        returning: true,
        // Why the saved id first: a retry after a quit reuses the id the first
        // attempt chose, which is how its leftover tab is found and replaced.
        returnTabId: entry.returnTabId ?? options.returnTabId
      })
      if (!taken) {
        return null
      }
      if (options.rendererId !== undefined) {
        reservedBy.set(snoozedTabKey(taken), options.rendererId)
      }
      deps.save(entries.map((existing) => (existing === entry ? taken : existing)))
      changed()
      return {
        entry: taken,
        scrollback: taken.scrollbackRef ? deps.scrollback.read(taken.scrollbackRef) : null
      }
    },

    /**
     * The reopened plain tab's terminal started (or the user closed it). An
     * entry with a conversation is never settled from here: "a terminal
     * started" does not prove the conversation did, so only settleReturn does.
     */
    settle(ref: SnoozedTabRef, rendererId?: number): boolean {
      const { entries, entry } = find(ref)
      return entry && !entry.agentSession && holds(entry, rendererId)
        ? remove(entries, [entry])
        : false
    },

    /**
     * Main started this conversation's terminal for the returning tab. The row
     * leaves the list now, so the save that writes the tab's terminal binding
     * also writes the row's removal: a crash can never keep both a good tab
     * and a row that would close it at the next launch. `commit` once that
     * save succeeded; `rollback` (back on the shelf) when it failed, or when
     * `cancelled` says the user closed the tab while the terminal started.
     */
    stageReturnSettle(
      owner: AgentResumeOwner
    ): { cancelled: boolean; commit: () => void; rollback: () => void } | null {
      const entries = read()
      const entry = entries.find(
        (existing) => existing.returning && ownsConversation(existing, owner)
      )
      if (!entry) {
        return null
      }
      const key = snoozedTabKey(entry)
      const wasCancelled = cancelled.delete(key)
      reservedBy.delete(key)
      if (!wasCancelled) {
        // A cancelled return keeps its row: nothing is being saved for it.
        deps.save(entries.filter((existing) => existing !== entry))
      }
      return {
        cancelled: wasCancelled,
        commit: () => {
          if (entry.scrollbackRef) {
            deps.scrollback.remove(entry.scrollbackRef)
          }
          changed()
        },
        rollback: () => {
          const now = read()
          const still = now.find((existing) => sameSnoozedTab(existing, entry))
          if (!shelve(now, still?.returning ? [still] : []) && !still) {
            const { returning: _returning, ...rest } = entry
            deps.save([...now, { ...rest, until: null, ready: false }])
            changed()
          }
        }
      }
    },

    putBack(ref: SnoozedTabRef, rendererId?: number): boolean {
      const { entries, entry } = find(ref)
      if (!entry || !holds(entry, rendererId)) {
        return false
      }
      const owner = entry.agentSession?.resumeOwner
      if (owner && deps.abandonReturnClaim?.(owner)) {
        // Why not shelved: main is starting this conversation's terminal right
        // now. Shelving here would leave a running terminal nobody settles,
        // so the spawn's completion is told to stop it and shelve instead.
        reservedBy.delete(snoozedTabKey(entry))
        cancelled.add(snoozedTabKey(entry))
        return false
      }
      return shelve(entries, [entry])
    },

    /** A window closed, crashed or reloaded: the returns it held go back on the shelf. */
    releaseRenderer(rendererId: number): boolean {
      const entries = read()
      const held = entries.filter(
        (entry) => entry.returning && reservedBy.get(snoozedTabKey(entry)) === rendererId
      )
      return shelve(
        entries,
        held.filter((entry) => {
          const owner = entry.agentSession?.resumeOwner
          if (owner && deps.abandonReturnClaim?.(owner)) {
            // Why not shelved yet: main is starting this conversation's
            // terminal. It stays off the shelf, held by no window, until that
            // spawn settles it (settleReturn) or fails (releaseReturn).
            reservedBy.delete(snoozedTabKey(entry))
            return false
          }
          return true
        })
      )
    },

    /** Main could not start (or keep) this conversation's terminal: back on the shelf. */
    releaseReturn(owner: AgentResumeOwner): boolean {
      const entries = read()
      return shelve(
        entries,
        entries.filter((entry) => entry.returning && ownsConversation(entry, owner))
      )
    },

    /**
     * Run once at launch: a return cut short by a quit starts over. The entry
     * is ready again, so the worktree's window takes it and finishes the job.
     */
    recoverInterruptedReturns(): void {
      const entries = read()
      shelve(
        entries,
        entries.filter((entry) => entry.returning),
        true
      )
    },

    /** A new time (null: until brought back), or now: ready at once. */
    setTime(ref: SnoozedTabRef, until: number | null): boolean {
      const { entries, entry } = find(ref)
      if (!entry || entry.returning) {
        return false
      }
      const next = Number.isFinite(until) ? (until as number) : null
      const moved = { ...entry, until: next, ready: next != null && next <= now() }
      deps.save(entries.map((existing) => (existing === entry ? moved : existing)))
      changed()
      return true
    },

    discard(ref: SnoozedTabRef): boolean {
      const { entries, entry } = find(ref)
      return entry ? remove(entries, [entry]) : false
    },

    /** The worktree is gone for good: so are its snoozed tabs and their output. */
    discardWorktree(worktreeId: string): boolean {
      const entries = read()
      return remove(
        entries,
        entries.filter((entry) => entry.worktreeId === worktreeId)
      )
    },

    /**
     * True only while `rendererId` is bringing back the tab that owns this
     * conversation. A snoozed tab's layout and sleeping record left the
     * session when it closed, so this reservation is what vouches for its
     * resume; an entry still on the shelf vouches for nothing.
     */
    ownsReturn(owner: AgentResumeOwner, rendererId: number): boolean {
      return read().some((entry) => holds(entry, rendererId) && ownsConversation(entry, owner))
    }
  }
}
