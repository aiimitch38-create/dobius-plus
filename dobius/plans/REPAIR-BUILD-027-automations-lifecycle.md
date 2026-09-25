# REPAIR BUILD-027 — Automations lifecycle (#68 #69 #71) · Upstream

Branch `stabilize/027-automations-lifecycle` from `stabilize/integration` (e161813f).
Builds on BUILD-002 (scheduler gate), CX12 F4 (launch re-checks, gated RPC runNow) and BUILD-026
(coordinator run ownership, `unsettledLoops`). None of their behaviour is changed.

## Root causes
- **#68 completion race.** `AutomationService.markDispatchResult` wrote the result, then checked
  `run.usage` and awaited `collectAutomationRunUsage` before notifying and saving usage. Two
  completion signals for one run (renderer effect re-fire; the headless `.then(mark).catch(mark)`
  chain, whose `.catch` re-marks as `dispatch_failed` when the first mark throws) both passed the
  `run.usage` check before either await finished: two notifications, two usage scans, the last write
  winning, and the second signal could overwrite the recorded outcome (`completed` -> `dispatch_failed`).
  A throwing usage scan also rejected after the run was already final, so no notification was sent.
- **#69 stuck `dispatching`.** The renderer path persists `dispatching` then sends the IPC; the
  dispatch token that authorises the renderer's launch lives only in memory
  (`dispatch-tokens.ts`). A quit between the send and the renderer's `dispatched` report left the run
  `dispatching` forever. Worse, if nextRunAt had not advanced yet, the next start's scheduler called
  `createAutomationRun`, which returns the existing run for that occurrence whatever its status, and
  dispatched it again (possible duplicate agent run). The headless path wrote nothing before its
  awaited launch, so a crash mid-launch left `pending` and the same re-dispatch happened.
- **#71 background rejections with no owner.** `void this.evaluateDueRuns()` (timer, start,
  renderer-ready) had `try/finally` only: any throw in one automation (precheck runner rejecting,
  store error, bad rule) was an unhandled rejection in main, stopped every automation after it in
  that tick, and left its run `pending` with nextRunAt not advanced (retried every minute). The
  headless completion chain's last `.catch` could itself reject (e.g. run deleted mid-run ->
  "Automation run not found."). `orchestration.run` started `coordinator.runFromExistingRun()` with
  `.finally` only; `executeLoop` rethrows after marking the row failed, so every coordinator failure
  (e.g. "No tasks found", a DB error) became an unhandled rejection and the caller, who already got
  `status: 'running'`, had no way to see why the run died.
- **Extra scope (Codex w3 lead 1): Pause crew mid-run.** Verified: `orchestration.run` calls
  `assertExecutionAdmitted` once; `Coordinator.dispatchTask` sends through
  `runtime.sendTerminal` (`dobius-runtime.ts` `sendTerminal`, no execution gate). Pausing the crew
  during a run did not stop further dispatches. CONFIRMED, fixed.
- **Extra scope (Codex w3 lead 2): headless re-check placement.** (Superseded by review F2 below:
  the spawn-time window is now closed inside the runtime.) Verified in
  `service.ts requestHeadlessDispatch`: the CX12 re-check runs after the precheck await (the last
  await in the service) and synchronously before the dispatcher call; nothing awaits in between.
  Inside the dispatcher (`index.ts` serve-mode closure) the first await *is* the launch call
  (`createManagedWorktree` with `startupAgent`, or `launchAgentTerminal`); their internal awaits
  (repo resolution, `git worktree add`, remote trust) are part of the launch and cannot be split
  without editing `dobius-runtime.ts`. This is the same granularity as the renderer path (CX12
  checks right before workspace creation / agent launch). CONFIRMED correct at the service level;
  pinned by a new ordering test. Residual window noted for the reviewer.

## Fix
- `automations/run-lifecycle.ts` (new; `service.ts` is at the 300-line cap):
  - `finalizeAutomationRunResult` (was the body of `markDispatchResult`): if the stored run is
    already final, return it unchanged (clears tokens). Otherwise write the result synchronously —
    the first final result claims the run before any await — then collect usage, notify once, save
    usage. Keeps the existing "result already carries usage" short-circuit.
  - `markInterruptedAutomationRuns(store)`: every `dispatching` run -> `dispatch_failed` with
    `INTERRUPTED_DISPATCH_ERROR` ("Dobius stopped before this run confirmed its launch. The agent may
    or may not have started; check the workspace before running it again."). No auto-retry.
  - `recordAutomationEvaluationFailure`: logs, marks this occurrence's `pending`/`dispatching` run
    `dispatch_failed` with `Scheduler error: <message>`, advances nextRunAt; its own failure is
    logged, never thrown.
  - `reportAutomationBackgroundFailure`: one `console.error` line (error message only; no prompt).
- `automations/service.ts`:
  - constructor calls `markInterruptedAutomationRuns` (the service is constructed once per process,
    before any dispatch; `start()` can run again on window re-creation, so it is not used).
  - `markDispatchResult` delegates to `finalizeAutomationRunResult`.
  - `evaluateDueRuns`: per-automation `try/catch` -> `recordAutomationEvaluationFailure`; outer catch
    logs a failed tick. `void` callers can no longer reject.
  - `evaluateAutomation`: a run for this occurrence that is no longer `pending` is not dispatched
    again; nextRunAt advances.
  - headless: persist `dispatching` (launch intent) after the CX12 re-check and before the
    dispatcher; the completion chain ends in a logging `.catch`.
- `automations/run-usage-collection.ts`: `collectAutomationRunUsage` never rejects; a throwing
  provider scan becomes `unavailable/scan_failed` usage, so the claimed run still notifies.
- `runtime/rpc/methods/orchestration-gates.ts`: the detached loop gets `.catch` ->
  `recordCoordinatorFailure`: logs, marks the row `failed` if still `running`, and inserts a
  high-priority `status` message from `orchestration` to the coordinator handle with the reason
  (visible through `orchestration.check`). `.finally` still releases `activeCoordinator` and
  `unsettledLoops` (BUILD-026 unchanged).
- `runtime/orchestration/coordinator.ts` (extra scope): `isDispatchAdmitted()` =
  `checkExecutionAdmission('agent-run')`, checked at the start of `dispatchReadyTasks` (no worker
  terminal is created while paused) and in `dispatchTask` after the last await, next to the
  BUILD-026 `stopped`/`ready` re-check and before `createDispatchContext`. Blocked -> return; the
  task stays `ready` (no failure count), logged once per hold via `onLog` and `console.warn` (the RPC
  caller passes no `onLog`), re-armed when admission returns.

## Tests
- `automations/service-lifecycle.test.ts` (new, 6 tests):
  - #68 two simultaneous completion signals (`completed` then `dispatch_failed`) -> one usage scan,
    one notification, outcome stays `completed` with the usage.
  - #68 usage scan throws -> `unavailable/scan_failed` usage, one notification.
  - #69 run left `dispatching` by a previous process -> startup marks it interrupted; the due
    scheduler does not re-dispatch it (no renderer send, one run, nextRunAt advanced).
  - #69 headless: the dispatcher sees `dispatching` both on its argument and in the store; call order
    ends `precheck, admission, dispatch` (lead 2 pin).
  - #71 first automation's precheck rejects -> its run `dispatch_failed` with the reason, nextRunAt
    advanced, the next automation still dispatched, no unhandled rejection.
  - #71 headless completion after the automation was deleted -> logged, no unhandled rejection.
- `runtime/orchestration/coordinator.test.ts`: gate mocked (default allowed; existing tests
  unchanged). New: pause while the dispatch awaits its drift probe -> no dispatch context, task
  `ready`, hold logged once over several ticks; resume -> dispatched and the run completes. Paused
  from the start -> no worker terminal created.
- `runtime/rpc/methods/orchestration-gates-lifecycle.test.ts`: a rejecting loop (no tasks) -> row
  `failed`, inbox message with the reason, no unhandled rejection, and a new run starts.

## Mutation checks (script: stabilize-run/027/mut/run.py; each broke its test, originals restored)
- M1 first-final claim removed -> duplicate-signal test fails.
- M2 usage scan catch rethrows -> scan-failure test fails.
- M3 startup reconcile removed -> interrupted test fails.
- M4 non-pending guard removed -> interrupted test fails (re-dispatch).
- M5 headless intent write removed -> persist test fails.
- M6 per-automation catch rethrows -> rejected-tick test fails.
- M7 completion-chain catch removed -> deleted-automation test fails.
- M8 coordinator final admission check removed -> pause-mid-run test fails.
- M9 coordinator tick-start check removed -> no-terminal test fails.
- M10 gates `.catch` removed -> rejected-loop test fails.
- M11 CX12 headless re-check disabled -> ordering test fails.

## Verification
- `pnpm run typecheck`: exit 0.
- Targeted vitest (automations/*, orchestration/*, orchestration-gates admission/lifecycle,
  rpc orchestration + automations, ipc automations, renderer automations): 405 passed, 2 skipped;
  2 failures in `renderer/.../automation-source-display.test.ts`, which is in basefail.txt and
  untouched.
- oxlint (both configs) clean on all changed files; `service.ts` under the 300-line cap.
- Full suite: DEFERRED (coordinator).

## Deviations from EXECUTION-ORDER.md
- New `automations/run-lifecycle.ts`: `service.ts` was at the max-lines cap, so the finalization
  body and the new recovery helpers live there (no lint disable).
- `run-usage-collection.ts` (small): usage scan failures resolve as `scan_failed` so the
  first-final claim cannot drop the notification.
- `coordinator.ts` + test: extra scope from the brief (Pause crew mid-run).
- No new run status: "interrupted" is `dispatch_failed` with an explicit message, so no renderer,
  shared-type or persistence change is needed and the UI already shows it as a failed run.
- Pending runs from a previous process are left alone: nothing launches before `dispatching` is
  persisted (both paths), so a `pending` scheduled run is safe for the scheduler to pick up again.

## Review round 1 (F1 document, F2 fix)
- **F2 [low] headless spawn-time gap.** The CX12 re-check ran before the serve-mode dispatcher, but
  the dispatcher's launch call itself awaits (`resolveRepoSelector`, `git worktree add`, meta
  writes, remote trust) before the agent spawns, so Pause crew could turn on in between.
  - `HeadlessAutomationDispatcher` request gains `honorExecutionGate`; `service.ts` passes it.
  - `index.ts` serve closure passes `executionOrigin: 'agent-run'` to `createManagedWorktree` /
    `launchAgentTerminal` only when `honorExecutionGate` is set (desktop manual runs unchanged).
  - `dobius-runtime.ts`: `executionOrigin?: ExecutionOrigin` on `createManagedWorktree` args (and
    the remote-create args it spreads into) and `launchAgentTerminal` opts. New private
    `assertAgentSpawnAdmitted(origin, createdWorkspacePath?)` runs right before each agent-starting
    `createTerminal`: the folder-workspace, local git and SSH create paths, and
    `launchAgentTerminal`. Blocked -> `ExecutionBlockedError` whose message ends with
    "Workspace <path> was created, but no agent was started in it." The three startup `catch`
    blocks rethrow `ExecutionBlockedError` instead of folding it into `warning`, so it reaches
    `requestHeadlessDispatch`, whose existing catch records `skipped_unavailable` with that
    message (the path stays on the run; the workspace is kept, never deleted).
  - No caller without `executionOrigin` changes behaviour.
  - `service.ts` hit the line cap again: the headless completion chain moved to
    `run-lifecycle.ts settleHeadlessCompletion` (same then/catch/catch, precheckResult only on the
    success write as before).
- **F1 [low, documented] startup cleanup and multiple instances.** `markInterruptedAutomationRuns`
  closes every `dispatching` run, including one owned by another live process sharing the same
  userData. Not fixed: two instances on one profile already overwrite each other's whole state
  file, so per-run owner tracking would not make that setup safe.

### Tests (round 1)
- `runtime/dobius-runtime.test.ts` (execution gate mocked, allowed by default): Pause crew turned
  on inside `addWorktree` during a gated `createManagedWorktree` -> rejects with
  `ExecutionBlockedError` naming the workspace path, no PTY spawned; gated `launchAgentTerminal`
  while paused -> rejects, no spawn.
- `automations/service-lifecycle.test.ts`: dispatcher gets `honorExecutionGate: true` for a
  scheduled run and `false` for a desktop manual run; a spawn-time `ExecutionBlockedError` is
  recorded as `skipped_unavailable` with the workspace path.

### Mutation checks (round 1; script stabilize-run/027/mut/run2.py, originals restored)
- M12 spawn gate always passes -> runtime test fails.
- M13 git-path catch swallows the block into `warning` -> runtime test fails.
- M14 `launchAgentTerminal` check removed -> runtime test fails.
- M15 service passes `honorExecutionGate: false` -> service test fails.
- Not unit-covered: the `index.ts` closure wiring (serve-only, no harness) and the folder/SSH
  create sites (same helper and rethrow as the tested git path).

### Verification (round 1)
- `pnpm run typecheck` exit 0; oxlint (both configs) clean on all changed files.
- Targeted: automations/*, orchestration/*, dobius-runtime.test.ts, orchestration-gates
  admission/lifecycle, rpc orchestration + automations, ipc automations: 860 passed, 2 skipped.

## Known limits
- Multiple Dobius+ instances on one userData are unsupported: startup cleanup closes the other
  instance's `dispatching` runs (and the shared state file is already last-writer-wins).
- A spawn-time Pause crew refusal leaves the freshly created workspace on disk; its path is in the
  run's error. It is not deleted automatically (never delete user data).

## Decisions for Carson
- An interrupted run (quit/crash mid-dispatch) is shown as failed with "check the workspace before
  running it again" and is never retried automatically.
- Multiple instances on one userData are unsupported (see Known limits); no owner tracking added.

## Rollback
Revert the commit. No schema or file-format change; runs already closed as interrupted stay
`dispatch_failed`.

## Lessons
- `createAutomationRun` is idempotent per occurrence and returns the run in any state; callers
  must check the status before dispatching it.
- `vi.useFakeTimers` plus `process.on('unhandledRejection')` works for proving no unhandled
  rejection, but switch to real timers before the final settle wait.
