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

export type TabSnoozeScrollbackStore = {
  write: (key: string, buffer: string) => string | null
  read: (ref: string) => string | null
  remove: (ref: string) => void
}

export type TabSnoozeDeps = {
  /** The saved list, as it is on disk (cleaned here on every read). */
  load: () => unknown
  save: (entries: SnoozedTabEntry[]) => void
  scrollback: TabSnoozeScrollbackStore
  /** Told after every change (main broadcasts tabSnooze:changed). */
  onChange: () => void
  /** True when main itself can see this pane running this conversation. */
  verifyResumeOwner?: (owner: AgentResumeOwner) => boolean
  /** A snoozed tab gave its conversation up, so its return may claim it again. */
  onConversationSnoozed?: (owner: AgentResumeOwner) => void
  now?: () => number
}

export type TabSnoozeService = ReturnType<typeof createTabSnoozeService>

export function createTabSnoozeService(deps: TabSnoozeDeps) {
  const now = deps.now ?? Date.now
  let timer: ReturnType<typeof setTimeout> | null = null
  const read = (): SnoozedTabEntry[] => cleanSnoozedTabEntries(deps.load())

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
        if (!owner || deps.verifyResumeOwner?.(owner) === false) {
          return { ok: false, reason: 'conversation-not-resumable' }
        }
        deps.onConversationSnoozed?.(owner)
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
      options: { onlyReady?: boolean; returnTabId?: string } = {}
    ): TakenSnoozedTab | null {
      const entries = read()
      const entry = entries.find((existing) => sameSnoozedTab(existing, ref))
      if (!entry || entry.returning || (options.onlyReady && !entry.ready)) {
        return null
      }
      const taken = cleanSnoozedTabEntry({
        ...entry,
        returning: true,
        // Why the saved id first: a retry after a quit reuses the tab the
        // first attempt already made.
        returnTabId: entry.returnTabId ?? options.returnTabId
      })
      if (!taken) {
        return null
      }
      deps.save(entries.map((existing) => (existing === entry ? taken : existing)))
      changed()
      return {
        entry: taken,
        scrollback: taken.scrollbackRef ? deps.scrollback.read(taken.scrollbackRef) : null
      }
    },

    /** The reopened tab's terminal started (or the user closed it): the entry is done. */
    settle(ref: SnoozedTabRef): boolean {
      const entries = read()
      const entry = entries.find((existing) => sameSnoozedTab(existing, ref))
      if (!entry?.returning) {
        return false
      }
      deps.save(entries.filter((existing) => existing !== entry))
      if (entry.scrollbackRef) {
        deps.scrollback.remove(entry.scrollbackRef)
      }
      changed()
      return true
    },

    /** A return that failed: back on the shelf until the user brings it back. */
    putBack(ref: SnoozedTabRef): boolean {
      const entries = read()
      const entry = entries.find((existing) => sameSnoozedTab(existing, ref))
      if (!entry?.returning) {
        return false
      }
      const { returning: _returning, ...rest } = entry
      deps.save(
        entries.map((existing) =>
          existing === entry ? { ...rest, until: null, ready: false } : existing
        )
      )
      changed()
      return true
    },

    /**
     * Run once at launch: a return cut short by a quit starts over. The entry
     * is ready again, so the worktree's window takes it and finishes the job.
     */
    recoverInterruptedReturns(): void {
      const entries = read()
      if (!entries.some((entry) => entry.returning)) {
        return
      }
      deps.save(
        entries.map((entry) => {
          if (!entry.returning) {
            return entry
          }
          const { returning: _returning, ...rest } = entry
          return { ...rest, ready: true }
        })
      )
      changed()
    },

    /** A new time (null: until brought back), or now: ready at once. */
    setTime(ref: SnoozedTabRef, until: number | null): boolean {
      const entries = read()
      if (!entries.some((entry) => sameSnoozedTab(entry, ref) && !entry.returning)) {
        return false
      }
      const next = Number.isFinite(until) ? (until as number) : null
      deps.save(
        entries.map((entry) =>
          sameSnoozedTab(entry, ref)
            ? { ...entry, until: next, ready: next != null && next <= now() }
            : entry
        )
      )
      changed()
      return true
    },

    discard(ref: SnoozedTabRef): boolean {
      const entries = read()
      const entry = entries.find((existing) => sameSnoozedTab(existing, ref))
      if (!entry) {
        return false
      }
      deps.save(entries.filter((existing) => existing !== entry))
      if (entry.scrollbackRef) {
        deps.scrollback.remove(entry.scrollbackRef)
      }
      changed()
      return true
    },

    /**
     * True when this owner belongs to a snoozed tab, on the shelf or on its
     * way back. A snoozed tab's layout and sleeping record left the session
     * when it closed, so this list is what vouches for its resume.
     */
    ownsResumeOwner(owner: AgentResumeOwner): boolean {
      const fingerprint = getAgentResumeOwnerFingerprint(owner)
      return read().some(
        (entry) =>
          entry.agentSession?.resumeOwner &&
          getAgentResumeOwnerFingerprint(entry.agentSession.resumeOwner) === fingerprint
      )
    }
  }
}

let activeService: TabSnoozeService | null = null

export function setActiveTabSnoozeService(service: TabSnoozeService | null): void {
  activeService = service
}

/** The claim gate's question (main/ipc/pty.ts): does a snoozed tab own this resume? */
export function isSnoozedTabResumeOwner(owner: AgentResumeOwner): boolean {
  return activeService?.ownsResumeOwner(owner) ?? false
}
