import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store'
import { isRemoteWorkspaceSnapshotApplyInProgress } from './useIpcEvents'
import { getSystemPrefersDarkSnapshot } from '../components/terminal-pane/use-system-prefers-dark'
import { shutdownBufferCaptures } from '../components/terminal-pane/shutdown-buffer-captures'
import { dispatchWindowCloseRequest } from '../components/window-close-request-coordinator'
import {
  canSkipRuntimeMobileSessionSyncKeyBuild,
  getRuntimeMobileSessionSyncKey,
  runtimeMobileSessionSyncKeysEqual,
  scheduleRuntimeGraphSync,
  setRuntimeGraphStoreStateGetter,
  setRuntimeGraphSyncEnabled
} from '../runtime/sync-runtime-graph'
import { registerUpdaterBeforeUnloadBypass } from '@/lib/updater-beforeunload'
import { createSessionWriteSubscriber } from '@/lib/session-write-subscriber'
import {
  patchWorkspaceSessionByHost,
  persistWorkspaceSessionByHostSync
} from '@/lib/workspace-session-host-persistence'
import { buildWorkspaceSessionPayload, shouldPersistWorkspaceSession } from '@/lib/workspace-session'
import { applyRemoteWorkspacePatchStatus } from '@/lib/apply-remote-workspace-patch-status'

type GitHubRefreshActions = Pick<
  AppState,
  | 'refreshAllGitHub'
  | 'bumpGitHubPRVisibleRefreshGeneration'
  | 'reportVisibleGitHubPRRefreshCandidates'
>

// Why: session persistence never drives JSX — it only writes to disk and
// registers process-lifetime subscriptions. Kept as one hook (not split
// further) because each effect is a small, independent app-lifetime
// registration with no shared state between them.
export function useAppLifecyclePersistence(
  workspaceSessionReady: boolean,
  githubRefreshActions: GitHubRefreshActions
): void {
  // Refresh GitHub data (PR/issue status) when window regains focus
  useEffect(() => {
    const handler = (): void => {
      if (document.visibilityState === 'visible') {
        githubRefreshActions.refreshAllGitHub()
        githubRefreshActions.bumpGitHubPRVisibleRefreshGeneration()
      } else {
        githubRefreshActions.reportVisibleGitHubPRRefreshCandidates([], Date.now())
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [githubRefreshActions])

  useEffect(() => {
    setRuntimeGraphStoreStateGetter(useAppStore.getState)
    return () => {
      setRuntimeGraphStoreStateGetter(null)
    }
  }, [])

  useEffect(() => {
    let previousKey = getRuntimeMobileSessionSyncKey(useAppStore.getState())
    return useAppStore.subscribe((state, previousState) => {
      // Why: this subscriber fires on every store mutation (PTY/agent-status
      // ticks). Read the cached prefers-dark snapshot — kept fresh by the shared
      // listener that useSystemPrefersDark() below already mounts — instead of
      // allocating a throwaway MediaQueryList via matchMedia on every tick,
      // before the skip-gate even runs.
      const systemPrefersDark = getSystemPrefersDarkSnapshot()
      // Why: skip the key build entirely when every input field is unchanged
      // by reference. Mirrors every field used by
      // getRuntimeMobileSessionSyncKey so this gate covers every "could the
      // key have changed?" case.
      if (
        canSkipRuntimeMobileSessionSyncKeyBuild(
          state,
          previousState,
          systemPrefersDark,
          previousKey.systemPrefersDark
        )
      ) {
        return
      }
      const nextKey = getRuntimeMobileSessionSyncKey(
        state,
        previousState,
        previousKey,
        systemPrefersDark
      )
      if (runtimeMobileSessionSyncKeysEqual(nextKey, previousKey)) {
        return
      }
      previousKey = nextKey
      scheduleRuntimeGraphSync()
    })
  }, [])

  useEffect(() => registerUpdaterBeforeUnloadBypass(), [])

  useEffect(() => {
    setRuntimeGraphSyncEnabled(workspaceSessionReady)
    return () => {
      setRuntimeGraphSyncEnabled(false)
    }
  }, [workspaceSessionReady])

  // Why: session persistence never drives JSX — it only writes to disk.
  // Using a Zustand subscribe() outside React removes ~15 subscriptions from
  // App's render cycle, eliminating re-renders on every tab/file/browser change.
  useEffect(() => {
    return createSessionWriteSubscriber({
      store: useAppStore,
      shouldSchedulePersist: () => !isRemoteWorkspaceSnapshotApplyInProgress(),
      persist: ({ patch }) => {
        const state = useAppStore.getState()
        // Why: route each runtime host's worktree-scoped slice to its own
        // partition; the returned promise is the local write so the
        // remote-workspace upload chain below keeps its ordering.
        const localWrite = patchWorkspaceSessionByHost(window.api.session, patch, state)
        void localWrite
        const hydratedTargetIds = Array.from(state.remoteWorkspaceHydratedTargetIds).filter(
          (targetId) => state.remoteWorkspaceSyncStatusByTargetId[targetId]?.phase !== 'conflict'
        )
        if (hydratedTargetIds.length > 0) {
          void localWrite
            .then(() => window.api.remoteWorkspace?.setForConnectedTargets({ hydratedTargetIds }))
            .then((results) => {
              for (const { targetId, result } of results ?? []) {
                applyRemoteWorkspacePatchStatus(targetId, result)
              }
            })
            .catch((err) => {
              for (const targetId of hydratedTargetIds) {
                useAppStore.getState().setRemoteWorkspaceSyncStatus(targetId, {
                  phase: 'error',
                  direction: 'push',
                  message: err instanceof Error ? err.message : 'Workspace upload failed'
                })
              }
            })
        }
      }
    })
  }, [])

  // On shutdown, capture terminal scrollback buffers and flush to disk.
  // Runs synchronously in beforeunload: capture → Zustand set → sendSync → flush.
  useEffect(() => {
    // Why: beforeunload fires twice during a manual quit — once from the
    // synthetic dispatch in the onWindowCloseRequested handler (captures
    // good data while TerminalPanes are still mounted), and again from the
    // native window close triggered by confirmWindowClose(). Between these
    // two firings, PTY exit events can arrive and unmount TerminalPanes,
    // emptying shutdownBufferCaptures. The guard prevents the second call
    // from overwriting the good session data with an empty snapshot.
    let shutdownBuffersCaptured = false
    const captureAndFlush = (): void => {
      if (shutdownBuffersCaptured) {
        return
      }
      if (!shouldPersistWorkspaceSession(useAppStore.getState())) {
        return
      }
      for (const capture of shutdownBufferCaptures.values()) {
        try {
          capture({ includeLocalBuffers: false })
        } catch {
          // Don't let one pane's failure block the rest.
        }
      }
      // Why: agent provider session ids live only in agentStatusByPaneKey,
      // which is in-memory. Capture them into the persisted sleeping-session
      // map so a daemon/session death while the app is closed can still
      // cold-restore via the agent's resume command (#5232).
      useAppStore.getState().captureAllSleepingAgentSessions()
      // Why: re-read state after capture() calls populated scrollback buffers
      // into the store via Zustand setters. The earlier read is only for the
      // gating flags and would miss those updates.
      const freshState = useAppStore.getState()
      persistWorkspaceSessionByHostSync(
        window.api.session,
        buildWorkspaceSessionPayload(freshState),
        freshState
      )
      shutdownBuffersCaptured = true
    }
    window.addEventListener('beforeunload', captureAndFlush)
    return () => window.removeEventListener('beforeunload', captureAndFlush)
  }, [])

  // Own the single window-close-request subscription at the always-mounted App
  // root. Why: the rich confirmation flow lives in Terminal, which is not
  // mounted on the no-workspace landing page (and is lazy-loaded elsewhere), so
  // subscribing there left File → Exit / Ctrl+Q with no listener and the window
  // never closed (#5144). dispatchWindowCloseRequest delegates to Terminal's
  // handler when present, else confirms the close directly.
  useEffect(() => {
    return window.api.ui.onWindowCloseRequested(dispatchWindowCloseRequest)
  }, [])
}
