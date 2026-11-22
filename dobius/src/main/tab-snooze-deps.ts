// What the snooze service (main/tab-snooze.ts) is given to work with.
import type { AgentResumeOwner } from '../shared/agent-resume-owner'
import type { SnoozedTabEntry } from '../shared/tab-snooze-types'

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
  /**
   * A window left mid-return: give its unspawned session claim back. True
   * when main is starting that terminal right now and will decide the outcome.
   */
  abandonReturnClaim?: (owner: AgentResumeOwner) => boolean
  now?: () => number
}
