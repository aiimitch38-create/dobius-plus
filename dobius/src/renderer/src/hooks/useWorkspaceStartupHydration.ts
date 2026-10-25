import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { AppState } from '@/store'
import { syncZoomCSSVar } from '@/lib/ui-zoom'
import {
  getStartupErrorFallbackUI,
  hydratePersistedUIAfterStartupRead
} from '@/lib/startup-ui-hydration'
import { fetchWorkspaceSessionFromHosts } from '@/lib/workspace-session-host-persistence'
import {
  logRendererStartupDiagnostic,
  timeRendererStartupStep,
  timeRendererStartupSyncStep
} from '@/startup/startup-diagnostics'
import { translate } from '@/i18n/i18n'
import type { OnboardingState } from '../../../shared/types'

type StartupHydrationActions = Pick<
  AppState,
  | 'fetchSettings'
  | 'fetchKeybindings'
  | 'fetchReposForAllHosts'
  | 'fetchProjectGroupsForAllHosts'
  | 'fetchFolderWorkspacesForAllHosts'
  | 'fetchAllWorktrees'
  | 'fetchWorktreeLineage'
  | 'hydratePersistedUI'
  | 'hydrateWorkspaceSession'
  | 'hydrateTabsSession'
  | 'hydrateEditorSession'
  | 'hydrateBrowserSession'
  | 'pruneLastVisitedTimestamps'
  | 'seedActiveWorktreeLastVisitedIfMissing'
  | 'fetchBrowserSessionProfiles'
  | 'setDeferredSshReconnectTargets'
  | 'setSshConnectionState'
  | 'reconnectPersistedTerminals'
  | 'setHydrationSucceeded'
  | 'initGitHubCache'
>

export type UseWorkspaceStartupHydrationParams = {
  actions: StartupHydrationActions
  setOnboarding: Dispatch<SetStateAction<OnboardingState | null>>
  setOnboardingLoaded: Dispatch<SetStateAction<boolean>>
}

// Why: fetches settings/repos/worktrees/session on mount and reconnects
// persisted terminals + SSH targets before the workspace becomes usable. Kept
// as one effect (not split further) because its steps are deliberately
// ordered/overlapped for startup latency (see the inline Why comments) and
// its error path must observe the same `cancelled`/`reconnectStarted` guards
// as the success path.
export function useWorkspaceStartupHydration({
  actions,
  setOnboarding,
  setOnboardingLoaded
}: UseWorkspaceStartupHydrationParams): void {
  useEffect(() => {
    let cancelled = false
    // Why: AbortController must be declared outside the async block so the
    // cleanup function can abort it. Under StrictMode the effect runs twice;
    // without this, the first (unmounted) pass would keep spawning PTYs.
    const abortController = new AbortController()

    // Why (issue #1158): hydrate persisted UI immediately after ui.get()
    // succeeds, before any later session step can throw. The UI writer is
    // gated only on persistedUIReady, so falling back to defaults after a
    // successful ui.get() would serialize those defaults back to disk.
    let uiHydrated = false
    // Why (issue #1158): track whether the success-path call to
    // reconnectPersistedTerminals started so the catch path doesn't run it a
    // second time. Reconnect mutates store state via per-tab set() blocks
    // inside its loops (populating tabsByWorktree / ptyIdsByTabId); re-entering
    // it on partially-mutated state would double-set ptyIds and drain pending*
    // maps twice. If the success-path call started and threw mid-loop, those
    // per-tab set() blocks may have populated tabsByWorktree / ptyIdsByTabId
    // for some tabs but did NOT reach the tail set() that flips
    // workspaceSessionReady — so we still need to force the flag true so the
    // UI mounts.
    let reconnectStarted = false
    void (async () => {
      const startupStartedAt = performance.now()
      logRendererStartupDiagnostic('startup-chain-start')
      try {
        // Why: repo/worktree hydration routes through settings.activeRuntimeEnvironmentId.
        // Load settings first so a persisted remote runtime does not boot against
        // the local filesystem and then hydrate stale local workspace state.
        await timeRendererStartupStep('fetch-settings', () => actions.fetchSettings())
        // Why: these three reads are main-side store/file reads with no
        // dependency on anything fetched below, so start them now and await
        // them at their original positions — the round-trips overlap the
        // repo/worktree scans instead of queuing after them. Browser session
        // profiles are deliberately NOT started early: on a remote runtime
        // they route through a runtime RPC that may not be connected this
        // early, and a failed fetch clears the profile list. The floating
        // .catch marks the rejection handled if an earlier awaited step
        // throws first; each await still rethrows its own failure.
        const uiGetPromise = timeRendererStartupStep('ui-get', () => window.api.ui.get())
        uiGetPromise.catch(() => {})
        const keybindingsPromise = timeRendererStartupStep('fetch-keybindings', () =>
          actions.fetchKeybindings()
        )
        keybindingsPromise.catch(() => {})
        const onboardingPromise = timeRendererStartupStep('onboarding-get', () =>
          window.api.onboarding.get()
        )
        onboardingPromise.catch(() => {})
        // Why: load local + every configured runtime environment (not just the
        // active one) so a cold start that restored a remote workspace doesn't
        // hide local repos. The sidebar "All hosts" scope then shows them all.
        await timeRendererStartupStep('fetch-repos', () => actions.fetchReposForAllHosts())
        // Why: project-groups/folder-workspaces read neither the repos store nor
        // worktrees, so once repos land they can overlap the per-repo
        // `git worktree list` fan-out (#7225) instead of queuing ahead of it — a
        // slow remote host's 15s scope RPCs no longer block the scan. folders
        // still follow project-groups (they read projectGroups); all settle
        // before the hydrate steps below.
        const projectScopeChain = (async () => {
          await timeRendererStartupStep('fetch-project-groups', () =>
            actions.fetchProjectGroupsForAllHosts()
          )
          await timeRendererStartupStep('fetch-folder-workspaces', () =>
            actions.fetchFolderWorkspacesForAllHosts()
          )
        })()
        // Why: worktrees + lineage both fan out `git worktree list` per repo on
        // the main process. Running them concurrently lets it share one
        // in-flight scan per repo instead of paying the process-spawn fan-out
        // twice back-to-back — the dominant renderer-chain cost on Windows
        // (issue #7225). Lineage only reads settings + its own slice, so it
        // does not depend on the worktrees fetch having landed.
        await Promise.all([
          projectScopeChain,
          timeRendererStartupStep('fetch-worktrees', () => actions.fetchAllWorktrees()),
          timeRendererStartupStep('fetch-worktree-lineage', () => actions.fetchWorktreeLineage())
        ])
        const persistedUI = await uiGetPromise
        uiHydrated = timeRendererStartupSyncStep('hydrate-persisted-ui', () =>
          hydratePersistedUIAfterStartupRead({
            persistedUI,
            cancelled,
            hydratePersistedUI: actions.hydratePersistedUI
          })
        )
        // Why: runtime-owned worktree slices live in per-host partitions.
        // Repos were fetched above, so the known runtime hosts are derivable
        // here; merge their slices into the unified session the hydrators
        // expect. An unreadable host partition is skipped (fail-soft).
        const session = await timeRendererStartupStep('session-get', () =>
          fetchWorkspaceSessionFromHosts(window.api.session, useAppStore.getState().repos)
        )
        await keybindingsPromise
        if (!cancelled) {
          timeRendererStartupSyncStep('hydrate-session-stores', () => {
            actions.hydrateWorkspaceSession(session)
            actions.hydrateTabsSession(session)
            actions.hydrateEditorSession(session)
            actions.hydrateBrowserSession(session)
          })
          // Why: prune lastVisitedAtByWorktreeId entries whose worktrees
          // no longer exist. Must run AFTER hydration — before this point,
          // async repo loads may not have populated worktreesByRepo yet and
          // pruning would delete timestamps for worktrees that are about to
          // appear. Seed the restored active worktree's timestamp if missing
          // so users upgrading from a pre-feature build don't see the active
          // worktree sink in the empty-query list.
          // See docs/cmd-j-empty-query-ordering.md.
          timeRendererStartupSyncStep('visit-timestamp-prune', () => {
            actions.pruneLastVisitedTimestamps()
            actions.seedActiveWorktreeLastVisitedIfMissing()
          })
          await timeRendererStartupStep('fetch-browser-session-profiles', () =>
            actions.fetchBrowserSessionProfiles()
          )
          const onboardingState = await onboardingPromise
          if (!cancelled) {
            setOnboarding(onboardingState)
            setOnboardingLoaded(true)
          }

          // Why: SSH connections must be re-established BEFORE terminal
          // reconnect so that reconnectPersistedTerminals can route SSH-backed
          // tabs through pty.attach on the relay. Passphrase-protected targets
          // are deferred to tab focus to avoid stacking credential dialogs at
          // startup before the user has context.
          const connectionIds = session.activeConnectionIdsAtShutdown ?? []
          if (connectionIds.length > 0) {
            try {
              const SSH_RECONNECT_TIMEOUT_MS = 15_000
              const allTargets = await timeRendererStartupStep('ssh-list-targets', () =>
                window.api.ssh.listTargets()
              )
              const targetMap = new Map(allTargets.map((t) => [t.id, t]))
              const targets = connectionIds.map((targetId) => ({
                targetId,
                needsPassphrase: targetMap.get(targetId)?.lastRequiredPassphrase ?? false
              }))

              const eagerTargets = targets.filter((t) => !t.needsPassphrase)
              const deferredTargets = targets.filter((t) => t.needsPassphrase)

              if (deferredTargets.length > 0) {
                actions.setDeferredSshReconnectTargets(deferredTargets.map((t) => t.targetId))
              }

              // Why: track which eager targets timed out so we can treat them
              // as deferred — the underlying ssh.connect() keeps running in the
              // main process, but reconnectPersistedTerminals won't see them as
              // connected. Adding them to the deferred list ensures PTYs get
              // reattached when the user focuses the tab (by which time the
              // slow connect will likely have succeeded).
              const timedOutTargets: string[] = []
              await timeRendererStartupStep(
                'ssh-reconnect',
                () =>
                  Promise.allSettled(
                    eagerTargets.map(({ targetId }) =>
                      Promise.race([
                        window.api.ssh.connect({ targetId }),
                        new Promise((_, reject) =>
                          setTimeout(
                            () => reject(new Error('SSH reconnect timeout')),
                            SSH_RECONNECT_TIMEOUT_MS
                          )
                        )
                      ]).catch((err) => {
                        const isTimeout =
                          err instanceof Error && err.message === 'SSH reconnect timeout'
                        if (isTimeout) {
                          timedOutTargets.push(targetId)
                        }
                        console.warn(`SSH auto-reconnect failed for ${targetId}:`, err)
                      })
                    )
                  ),
                {
                  eagerTargets: eagerTargets.length,
                  deferredTargets: deferredTargets.length
                }
              )
              if (timedOutTargets.length > 0) {
                actions.setDeferredSshReconnectTargets([
                  ...deferredTargets.map((t) => t.targetId),
                  ...timedOutTargets
                ])
              }

              // Why: ssh.connect() resolves before the ssh:state-changed IPC
              // event updates sshConnectionStates in the store. Without this,
              // reconnectPersistedTerminals reads stale state and misclassifies
              // successfully connected targets as disconnected, stranding their
              // persisted PTYs. Polling getState ensures the store is current.
              for (const { targetId } of eagerTargets) {
                if (timedOutTargets.includes(targetId)) {
                  continue
                }
                try {
                  const state = await window.api.ssh.getState({ targetId })
                  console.warn(
                    `[ssh-restore] Polled state for ${targetId}: status=${state?.status}`
                  )
                  if (state?.status === 'connected') {
                    actions.setSshConnectionState(targetId, state)
                  }
                } catch {
                  /* best-effort */
                }
              }
            } catch (err) {
              console.warn('SSH startup reconnect failed:', err)
            }
          } else {
            logRendererStartupDiagnostic('ssh-reconnect-skipped', { connectionIds: 0 })
          }

          // Why: main overlaps daemon/hook startup with renderer hydration for
          // first paint, but restored terminals still need those services ready
          // before they mount and spawn/reconnect PTYs.
          await timeRendererStartupStep('first-window-services-await', () =>
            window.api.app.awaitFirstWindowStartupServices()
          )
          reconnectStarted = true
          await timeRendererStartupStep('reconnect-terminals', () =>
            actions.reconnectPersistedTerminals(abortController.signal)
          )
          syncZoomCSSVar()
          // Why (issue #1158): unlock the debounced session writer only after
          // hydration AND all dependent startup steps (SSH reconnect, terminal
          // reconnect) completed without throwing. If this flag flipped earlier
          // and a later step threw, the catch path's reconnectPersistedTerminals
          // would flip workspaceSessionReady=true with the gate already open,
          // and the writer would serialize a partially-mutated store back to
          // disk — the exact data-loss mode this PR fixes.
          actions.setHydrationSucceeded(true)
          logRendererStartupDiagnostic('startup-hydration-done', {
            durationMs: Math.round(performance.now() - startupStartedAt)
          })
        }
      } catch (error) {
        // Why (issue #1158): previously this catch called hydrateWorkspaceSession
        // with empty defaults, which overwrote the in-memory tab map. The
        // debounced session writer then serialized that empty state back to
        // dobius-data.json, silently erasing the user's saved tabs. The fix is
        // to leave in-memory state untouched and keep hydrationSucceeded
        // false so the writer stays gated. We still ensure persistedUIReady and
        // workspaceSessionReady flip so the UI can mount without a session.
        const stepLabel = error instanceof Error && error.message ? error.message : String(error)
        console.error(
          '[startup] Workspace session hydration failed; leaving disk state untouched:',
          stepLabel,
          error
        )
        if (!cancelled) {
          // Why (issue #1158): only hydrate UI with defaults if ui.get() never
          // produced persisted data. If the real UI hydrate already ran and a
          // later session step threw, defaults would flow through the debounced
          // UI writer and clobber ui.json (sidebar width, sort, filters, etc.).
          const fallbackUI = getStartupErrorFallbackUI(uiHydrated)
          if (fallbackUI) {
            actions.hydratePersistedUI(fallbackUI)
          }
          // Why (issue #1158): surface a sticky, dismissible toast so the
          // user knows they're in degraded "no-save" mode. Without this, every
          // new tab/file/browse becomes silently ephemeral — `hydrationSucceeded`
          // stays false for the rest of the process and the session writer is
          // a no-op. The "Restart now" action calls app.relaunch (defined in
          // src/main/ipc/app.ts) so the user can recover with one click instead
          // of having to find a quit/relaunch path themselves.
          toast.error(translate('auto.App.12e77cf12b', 'Session restore failed'), {
            description: translate(
              'auto.App.0a9e810705',
              "Changes won't be saved until restart. Your previous tabs are safe on disk."
            ),
            duration: Infinity,
            dismissible: true,
            action: {
              label: translate('auto.App.caea5b51b9', 'Restart now'),
              onClick: () => {
                void window.api.app.relaunch()
              }
            }
          })
          // Why: reconnectPersistedTerminals flips workspaceSessionReady so the
          // UI mounts; auto-tab-creation becomes unblocked. hydrationSucceeded
          // is intentionally NOT set — the session writer must stay a no-op
          // until the user gets a clean restart, so we don't overwrite the
          // on-disk file we failed to load.
          if (!reconnectStarted) {
            try {
              await window.api.app.awaitFirstWindowStartupServices()
              await actions.reconnectPersistedTerminals(abortController.signal)
            } catch (reconnectErr) {
              console.error(
                '[startup] reconnectPersistedTerminals failed in error path:',
                reconnectErr
              )
              // Why (issue #1158): re-check !cancelled before mutating store
              // state. The await above may have run while the effect was being
              // torn down (StrictMode pass 1 cleanup) — in that case the
              // second pass owns hydration and we must not stomp its work
              // from a cancelled run.
              if (!cancelled) {
                // Why (issue #1158): this is already the recovery path from a
                // failed hydration. If the recovery itself throws, the async IIFE
                // rejects as an unhandled promise and workspaceSessionReady never
                // flips — leaving the user staring at a blank window. Forcing the
                // flag true lets the app shell mount with an empty session, which
                // is strictly better than a non-functional UI.
                //
                // Also clear pendingReconnect* maps because reconnectPersistedTerminals
                // normally drains them as part of its post-conditions
                // (see terminals.ts post-loop cleanup). Bypassing that drain by
                // flipping only the flag would leave stale reconnect data in
                // memory — any later reader of pending* maps could trigger
                // phantom reconnect attempts on PTYs that no longer exist.
                useAppStore.setState({
                  workspaceSessionReady: true,
                  pendingReconnectWorktreeIds: [],
                  pendingReconnectTabByWorktree: {},
                  pendingReconnectPtyIdByTabId: {}
                })
              }
            }
          } else {
            // Why (issue #1158): the success-path call to
            // reconnectPersistedTerminals already started; its per-tab set()
            // blocks may have populated tabsByWorktree / ptyIdsByTabId for
            // some tabs but did NOT reach the tail set() that flips
            // workspaceSessionReady (that runs after the loop completes).
            // Don't re-run reconnect over partially-mutated state — doing so
            // would double-set ptyIds and drain pending* maps twice. Force
            // the flag true so the UI mounts. The same pending* clear applies
            // here for the same reason as above.
            useAppStore.setState({
              workspaceSessionReady: true,
              pendingReconnectWorktreeIds: [],
              pendingReconnectTabByWorktree: {},
              pendingReconnectPtyIdByTabId: {}
            })
          }
        }
      }
      void actions.initGitHubCache()
    })()

    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [actions, setOnboarding, setOnboardingLoaded])
}
