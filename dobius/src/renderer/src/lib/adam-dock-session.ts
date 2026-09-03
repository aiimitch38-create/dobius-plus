import { useAppStore } from '@/store'
import { launchAgentBackgroundSession } from './launch-agent-background-session'
import type { AppState } from '@/store/types'

export const ADAM_DOCK_TAB_LABEL = 'Dobius ADAM chat'

export type AdamDockSession = { tabId: string; ptyId: string | null }

type AdamDockSessionStore = Pick<AppState, 'repos' | 'allWorktrees' | 'tabsByWorktree'>

/** ADAM is expected to already be a tracked Dobius+ project — it is, on this
 *  machine, extensively developed through this same app — so this resolves
 *  its worktree id from the repo list rather than assuming a fixed id. */
function resolveAdamWorktreeId(store: AdamDockSessionStore, adamDirectory: string): string | null {
  const repo = store.repos.find((entry) => entry.path === adamDirectory)
  if (!repo) {
    return null
  }
  return store.allWorktrees().find((worktree) => worktree.repoId === repo.id)?.id ?? null
}

function findAdamDockTab(store: AdamDockSessionStore, worktreeId: string): AdamDockSession | null {
  const tab = (store.tabsByWorktree[worktreeId] ?? []).find(
    (candidate) => candidate.customTitle === ADAM_DOCK_TAB_LABEL
  )
  return tab ? { tabId: tab.id, ptyId: tab.ptyId } : null
}

/**
 * Finds or starts the dock's single hidden ADAM chat session.
 *
 * Why launchAgentBackgroundSession, not a plain createTab: a floating-workspace
 * tab's PTY and queued startup command are only spawned/consumed when its
 * TerminalPane mounts — which never happens while the panel stays hidden, so
 * `claude` never actually started. launchAgentBackgroundSession is the same
 * headless-PTY path automation runs already use: it spawns the real PTY and
 * registers the agent's launch config immediately, with no pane required.
 * That does mean the session lives as an inactive tab in ADAM's own project
 * worktree (not the floating scratchpad) — if the user later opens the ADAM
 * project window, this tab exists there too, just not focused.
 */
export async function ensureAdamDockSession(): Promise<AdamDockSession | null> {
  const adamDirectory = await window.api.jarvis.getAdamProjectDirectory()
  const store = useAppStore.getState()
  const worktreeId = resolveAdamWorktreeId(store, adamDirectory)
  if (!worktreeId) {
    return null
  }
  const existing = findAdamDockTab(store, worktreeId)
  if (existing) {
    return existing
  }
  const launched = await launchAgentBackgroundSession({
    agent: 'claude',
    worktreeId,
    launchSource: 'shortcut',
    title: ADAM_DOCK_TAB_LABEL
  })
  if (!launched) {
    return null
  }
  return { tabId: launched.tabId, ptyId: launched.ptyId }
}

/** Reactive lookup for the dock's live ptyId, given a known ADAM tab id —
 *  searches every worktree since the ADAM tab lives in ADAM's own worktree,
 *  not a fixed one the caller can name ahead of time. */
export function findTerminalTabPtyId(
  state: Pick<AppState, 'tabsByWorktree'>,
  tabId: string
): string | null {
  for (const tabs of Object.values(state.tabsByWorktree)) {
    const tab = tabs?.find((candidate) => candidate.id === tabId)
    if (tab) {
      return tab.ptyId
    }
  }
  return null
}
