// "Resume all conversations?" bookkeeping (pure, no store). With the "Ask
// first" setting, a Board console's first restore after the app reopens starts
// its agent fresh and parks the last provider session here until the user
// answers the board toast. Automatic resume (the default) never touches it.
import type {
  AgentProviderSessionMetadata,
  ResumableTuiAgent,
  SleepingAgentLaunchConfig
} from '../../../../../shared/agent-session-resume'

export type BoardResumeMode = 'auto' | 'ask'

export function boardResumeModeOf(
  settings: { boardResumeMode?: BoardResumeMode } | null | undefined
): BoardResumeMode {
  return settings?.boardResumeMode === 'ask' ? 'ask' : 'auto'
}

export type DeferredBoardResume = {
  worktreeId: string
  tabId: string
  agent: ResumableTuiAgent
  providerSession: AgentProviderSessionMetadata
  launchConfig?: SleepingAgentLaunchConfig
}

export type BoardResumeRegistry = {
  /**
   * True when this restore should start fresh and wait for the toast. Once a
   * tab is parked it stays parked until answered; once answered it restores
   * normally for the rest of the app session.
   */
  decide: (entry: DeferredBoardResume, ctx: { ask: boolean; isBoardConsole: boolean }) => boolean
  /** True when the tab is parked or already answered (the gate must consult the registry). */
  knows: (tabId: string) => boolean
  pending: (worktreeId: string) => DeferredBoardResume[]
  /** Removes and returns the worktree's parked sessions, marking them answered. */
  take: (worktreeId: string) => DeferredBoardResume[]
  subscribe: (listener: () => void) => () => void
  /** Bumps on every change, for useSyncExternalStore. */
  version: () => number
}

export function createBoardResumeRegistry(): BoardResumeRegistry {
  const parked = new Map<string, DeferredBoardResume>()
  const answered = new Set<string>()
  const listeners = new Set<() => void>()
  let changes = 0
  const notify = (): void => {
    changes += 1
    for (const listener of listeners) {
      listener()
    }
  }
  return {
    decide(entry, { ask, isBoardConsole }) {
      if (answered.has(entry.tabId)) {
        return false
      }
      if (parked.has(entry.tabId)) {
        return true
      }
      if (!ask || !isBoardConsole) {
        return false
      }
      parked.set(entry.tabId, entry)
      notify()
      return true
    },
    knows: (tabId) => parked.has(tabId) || answered.has(tabId),
    pending: (worktreeId) => [...parked.values()].filter((e) => e.worktreeId === worktreeId),
    take(worktreeId) {
      const taken = [...parked.values()].filter((e) => e.worktreeId === worktreeId)
      for (const entry of taken) {
        parked.delete(entry.tabId)
        answered.add(entry.tabId)
      }
      if (taken.length > 0) {
        notify()
      }
      return taken
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    version: () => changes
  }
}

export type LivePaneSession = {
  tabId?: string
  state: string
  providerSession?: { id: string } | null
}

/**
 * Parked sessions still worth offering: the console is on the board and its
 * pane is not already running that same session (a PTY that survived reattach).
 */
export function resumableBoardEntries(
  entries: readonly DeferredBoardResume[],
  consoleTabIds: ReadonlySet<string>,
  liveSessions: readonly LivePaneSession[]
): DeferredBoardResume[] {
  return entries.filter(
    (entry) =>
      consoleTabIds.has(entry.tabId) &&
      !liveSessions.some(
        (live) =>
          live.tabId === entry.tabId &&
          live.state !== 'done' &&
          live.providerSession?.id === entry.providerSession.id
      )
  )
}

/** The app-wide registry the PTY restore gate and the board toast share. */
export const boardResumeRegistry = createBoardResumeRegistry()
