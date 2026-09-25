# REPAIR BUILD-024 — Dobius producer reconciliation (#43 #44 #45 #66)

## Root causes
- **#43** `asana-dispatch-ledger.ts` `hasBeenClaimed()` treats `claimed` as handled and nothing
  ever resets it. A crash or quit between `claimTask()` and the triage outcome left the task
  `claimed` until the 30-day prune (`firstSeenAt` cutoff), then it was re-triaged from scratch.
  Separately, `dispatch-build-handler.ts` recorded `buildDispatchedAt` only *after* the worktree
  dispatcher resolved, so a crash during the (up to 10 min) dispatch left no mark and the task
  could dispatch a second build once its claim was retried.
- **#44** `pruneOld()` dropped every record older than 30 days, including `dead` letters and
  records carrying `buildDispatchedAt`, so a dead-lettered task was re-triaged and a built task
  could be built again after 30 days (BUILD-007's one-build-per-task block was not permanent).
  It could also drop a live `claimed` record (reclaimed failed record with an old `firstSeenAt`),
  letting the next poll claim the same task twice.
- **#45** `maybeDispatchTask()` claimed the task *before* checking for a triage agent, then
  `appendNoAgentBrief()` called `recordBriefed()`: a configuration gap was stored as a finished
  intake, so the task was skipped (until the 30-day prune) even after an agent was picked.
- **#66** `agent-heartbeat-service.ts` `isDue()` for `hourly` required `now.getMinutes() === 0`.
  The 60 s interval is not aligned to :00 and drifts/skips after sleep, so whole hours were missed.

## Fix
- Ledger (`asana-dispatch-ledger.ts`):
  - Records gain optional `claimOwner` (a per-process `randomUUID()`), stamped by `claimTask()`.
    Parsed strictly (non-string = invalid, per CX12). Old code drops the field.
  - `reconcileInterruptedClaims()`: every `claimed` record whose owner is not this process
    (including legacy records with no owner) was interrupted; its run died with that process.
    Each counts as one failed attempt (`failed`, or `dead` at 2). No-op while unreadable.
  - `pruneOld()` keeps `dead`, `claimed` and `buildDispatchedAt` records forever; only transient
    `briefed`/`failed` outcomes age out.
  - `clearBuildDispatched()`, `listBlockedTaskGids()`, `requeueTask()` (see extra scope).
- `asana-auto-mode-service.ts`: each tick runs `reconcileInterrupted()` before `pruneOld()` and
  before any claim (briefs any task the reconciliation dead-letters). The no-triage-agent check
  (none set, or the set agent was deleted) now runs before `claimTask()`: nothing is written to
  the ledger, and a digest brief "Asana task in <lane> lane is blocked: ... (no triage agent set)"
  is filed once per task per process. Picking an agent makes the task eligible on the next poll.
- `dispatch-build-handler.ts` (outside file list): `recordBuildDispatched(gid)` now runs before the
  dispatcher is called (refuses if it cannot be saved); a thrown or `ok:false` dispatch calls
  `clearBuildDispatched(gid)` so retry behaviour is unchanged; a timeout keeps the mark (as before).
- `agent-heartbeat-service.ts`: hourly is due when `lastHeartbeatAt < startOfHour(now)` — any tick
  inside an hour that has not run fires once; after a long sleep exactly one catches up.
  Admission is still enforced by `startAgentRun` (BUILD-001/002). Added `agentHeartbeatInternals`
  test seam (same pattern as `asanaAutoModeInternals`).
- Extra scope (re-queue): Tasks panel shows a "Re-queue" link on tasks Auto Mode skips for good
  (dead-lettered or build recorded). Click → `window.confirm` → IPC `asana:requeueTask` (gid checked
  against `ASANA_GID_RE`) → `requeueTask()` removes the ledger record. Refused while the task is
  being triaged (`claimed`) or the ledger is unreadable (error shown as a toast). Deliberately
  renderer-only IPC, no RPC/CLI method: a re-queue can start a new paid build, so agents with the
  `dobius` CLI must not be able to trigger it. Never writes to Asana.

## Files
- `src/main/agents/asana-dispatch-ledger.ts`, `asana-auto-mode-service.ts`,
  `agent-heartbeat-service.ts`, `agent-tools/dispatch-build-handler.ts`
- `src/main/ipc/asana.ts`, `src/preload/index.ts`, `src/preload/api-types.ts`, `src/shared/asana.ts`,
  `src/renderer/src/components/right-sidebar/TasksPanel.tsx`
- Tests: `asana-dispatch-ledger.test.ts` (extended), `asana-auto-mode-producer.test.ts` (new, real
  ledger, fresh module graph = fresh process), `agent-heartbeat-schedule.test.ts` (new),
  `agent-tools/dobius-tool-server.test.ts` (one case added).

## Tests
- Crash after claim → restart reconciles → re-triaged exactly once, attempts 1; own live claim not
  reconciled; second interruption dead-letters and briefs; build recorded before the crash → never
  re-triaged or re-dispatched; legacy owner-less claim reconciled; unreadable ledger → no-op.
- Prune 31 days ahead keeps dead / dispatched / live-claimed, drops briefed; survives reload.
- No triage agent (or deleted agent) → no ledger record, one "blocked" brief across 3 ticks,
  unrelated claim untouched; setting the agent starts triage.
- Hourly: due at 10:07 after a 09:00 run, not due again in the same hour; fake-clock ticks at
  :03:17 after 3 h asleep → one run, next hour → one more.
- Dispatcher sees the task already marked while it runs; a failed dispatch clears the mark.
- Re-queue: dead and dispatched tasks listed and re-queued; refused while claimed or unreadable.
- Mutation checks (each failed, then restored; 63 targeted tests green after):
  M1 reconcile no-op (5 fail) · M2 reconcile own-process claims (1) · M3 prune drops dead (1) ·
  M4 no-agent path claims + records briefed (2) · M5 hourly back to `:00` (2) ·
  M6 no pre-dispatch mark (4) · M7 no clear on failed dispatch (2) · M8 re-queue of a live claim (1).

## Deviations from EXECUTION-ORDER.md
- Edited `agent-tools/dispatch-build-handler.ts` (not listed): without the pre-dispatch mark, a crash
  during worktree creation defeats "no double launch" for the reconciled claim.
- Extra scope from the brief: IPC + preload + shared type + Tasks panel link for re-queue.
- No renderer test for the Tasks panel link (logic is in the ledger, which is tested).

## Decisions for Carson
- An interrupted triage (crash or quitting the app mid-triage) counts as one failed attempt, so two
  interruptions dead-letter the task (then "Re-queue" brings it back). Safer against a task that
  crashes the app; the alternative is to retry without counting.
- Legacy records already marked `briefed` by the old no-agent path cannot be told apart from real
  triage and stay skipped until the normal 30-day retention; they are not shown as re-queueable.
- "Blocked, no triage agent" brief is once per task per app launch (restarts brief again).

## Rollback
Revert the commit. Old code ignores `claimOwner`; kept dead/dispatched records are valid old-format
records. Old code would again prune them after 30 days.

## Lessons
- The ledger's cached array is mutated in place by `findRecord()` callers; new functions work on
  the `load()` array and call `set()` on it, matching the existing pattern.
