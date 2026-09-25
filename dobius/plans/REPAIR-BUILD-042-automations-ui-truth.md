# REPAIR BUILD-042 — Automations UI truth (#96 #97) · Upstream

Branch `stabilize/042-automations-ui-truth` from `stabilize/integration` (6c753d3c).
Depends on BUILD-027 / BUILD-002 / CX12 (run states). No main-process or run-state change here.

## Root causes
- **#96 (C12) Run Now / Pause / Delete fail silently.** In `AutomationsPage.tsx`, `toggleAutomation`,
  `deleteAutomation` and `runNow` awaited the IPC/RPC call with no `catch`, and every caller invoked
  them as `void fn()` (detail toolbar, context menu, delete-confirm dialog, skip-confirm delete). A
  rejection (automation gone, runtime RPC timeout, store write error) became an unhandled promise
  rejection: no toast, no reload, nothing on screen. Second half: runNow does **not** reject when the
  service refuses to launch. `AutomationService.runNow` -> `requestDispatch` resolves with a run already
  marked `skipped_unavailable` (target unavailable, no window, Pause crew for RPC/CLI callers per
  CX12) and the page still toasted "Automation run queued." The rerun button had the same lie.
  Nothing guarded double clicks either, so a second Pause/Delete could be sent while the first was
  in flight.
- **#97 (C24) Any settings change reloads all automations and worktrees.** `refresh` was a
  `useCallback` over the whole `settings` object (only to read `activeRuntimeEnvironmentId`), and the
  mount effect `useEffect(() => { fetchAllWorktrees(); refresh() }, [fetchAllWorktrees, refresh])`
  re-ran whenever `refresh` changed identity. `updateSettings` replaces the settings object, so a theme
  switch (or any setting) refetched every worktree, all automations, all runs and external managers.
  The selected-automation runs effect also listed `settings` as a dependency and refetched too.

## Fix
- New `components/automations/use-automation-list-target.ts`: `useAutomationListTarget()` selects only
  `settings.activeRuntimeEnvironmentId` from the store and memoizes the `AutomationHostTarget` on it.
  `refresh` and the selected-runs effect depend on that target instead of `settings`. Switching
  runtime environment still reloads (target changes); theme and other settings do not.
- New `components/automations/use-automation-mutations.ts`:
  - `useAutomationMutations(refresh)` -> `{ pendingAutomationIds, runAutomationMutation }`. One action
    per automation at a time (ref guard, second click ignored). A rejection shows `toast.error` with the
    error's message (fallback text when it has none), then reloads the list so the page shows what the
    host really has (a reload failure is logged, never thrown). Pending is cleared in `finally`.
  - `getAutomationRunNowFailureDetail(run)`: a returned run whose status is `skipped_*` or
    `dispatch_failed` is reported as "Automation run did not start." with the run's recorded reason
    (e.g. the Pause crew message) or its status label; started runs keep "Automation run queued."
- `AutomationsPage.tsx`: toggle/delete/runNow go through `runAutomationMutation`; runNow and rerun show
  the real outcome via `showRunNowOutcome`; Run Now / Pause / Delete in the context menu and the detail
  toolbar are disabled while that automation's action is pending.
- `AutomationDetail.tsx`: optional `actionsPending` prop disables Run Now, Pause/Resume and Delete.
- `en.json`: five named keys under `AutomationsPage` (pauseFailed, resumeFailed, deleteFailed,
  runNowFailed, runNowNotStarted); other locales fall back to English, same as BUILD-047.

## Tests
- `use-automation-mutations.test.tsx` (new, happy-dom, 8 tests): a rejecting mutation shows the error,
  reloads once, and pending goes true -> false; the Run Now / Pause / Delete fallback messages when the
  error has no message; reload-after-failure also rejecting -> still resolves, pending cleared; a second
  action on the same automation while pending is ignored; run-now outcome: started runs are queued,
  `skipped_unavailable` shows its reason, `dispatch_failed` / blank error fall back to the status label.
- `use-automation-list-target.test.tsx` (new, happy-dom, 2 tests, zustand test store behind the
  `@/store` mock): a harness with the page's load-effect shape loads once; two theme changes do not
  reload; an environment change reloads with the new target and a later theme change does not.

## Mutation checks (script: stabilize-run/042/mut.py; originals restored after each)
- M1 error toast removed -> 5 tests fail.
- M2b `finally` pending cleanup removed -> 6 tests fail.
- M3 hook back to depending on the whole `settings` object -> both list-target tests fail.
- M4 run-now outcome always "queued" -> outcome test fails.
- M5 re-entry guard removed -> double-action test fails.
- M6 reload after failure removed -> rejection test fails.
- (M2, moving cleanup into the success path, was not a real mutation: the `finally` still ran. Dropped.)

## Verification
- `pnpm run typecheck`: exit 0.
- Targeted vitest `src/renderer/src/components/automations`: 111 passed, 2 failed — both in
  `automation-source-display.test.ts`, listed in basefail.txt, untouched.
- oxlint (default and react-doctor configs) clean on all changed files.
- Full suite: DEFERRED (coordinator).

## Deviations from EXECUTION-ORDER.md
- Two new hook files (brief: `AutomationsPage.tsx` is large, new logic goes in hooks).
- `AutomationDetail.tsx` (small): `actionsPending` prop so pending disables the toolbar buttons.
- `en.json`: five new keys.
- Rerun toast (outside the named line range) now uses the same run-now outcome: it had the same
  "queued" lie for a refused run.

## Known limits
- The page wiring (refresh depending on `automationListTarget`, not `settings`) is not unit-tested:
  `AutomationsPage` is a 3,000-line component with dozens of store and IPC dependencies. The test pins
  the hook's stability, which is what the wiring relies on.
- Other `settings`-dependent callbacks (`getAutomationHooksCacheKey`, `loadAutomationYamlHooksForRepo`)
  still change identity on any settings change, but their only effect runs while the create dialog is
  open and is cache-guarded per repo key, so it does not refetch.

## Decisions for Carson
- None.

## Rollback
Revert the commit. No data, IPC or schema change.

## Lessons
- A "silent failure" in this page has two shapes: a rejected promise nobody awaits, and a resolved
  run that was refused. The service reports refusals as resolved `skipped_*` runs, so the UI must read
  the returned status, not just the absence of an exception.
