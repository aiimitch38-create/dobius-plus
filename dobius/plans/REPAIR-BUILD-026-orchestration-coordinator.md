# REPAIR BUILD-026 — orchestration coordinator correctness (#62 #63 #64 #65) · Upstream

## Root causes
- **#62 orphaned `running` row.** Ownership of a coordinator run lives only in the module variable
  `activeCoordinator` (`orchestration-gates.ts`), but "is a run active" is read from the DB
  (`db.getActiveCoordinatorRun()`, `status = 'running'`). After a crash/restart the row outlives its
  owner: `orchestration.run` threw `Coordinator already running` forever, and `orchestration.runStop`
  returned `stopped: true` without changing the row. Only `orchestration.reset` (deleting all task
  history) cleared it.
- **#63 mixed timestamps.** `dispatched_at` and `last_heartbeat_at` are SQLite
  `YYYY-MM-DD HH:MM:SS` (from `datetime('now')` and `messages.created_at`) while the coordinator passes
  an ISO `...T...Z` threshold. `getStaleDispatches` compared them as strings; `' '` sorts before `'T'`,
  so every same-UTC-day row looked older than the threshold (fresh dispatches "hung"), while
  cross-midnight rows compared by date only.
- **#64 escalation not bound to an attempt.** `handleEscalation` took `taskId` from the payload and
  failed whatever `getDispatchContext(taskId)` returned (the latest row, any status), with no sender
  check. A delayed or duplicate escalation from an earlier attempt, another terminal, or the runtime's
  own exit escalation (whose dispatch it had already failed) failed the replacement attempt and
  pushed it toward the circuit breaker. `failDispatch` itself was unconditional: it re-counted failures
  on already failed/completed contexts and flipped the task to `ready`/`failed` whatever its status.
- **#65 global task namespace.** `decompose`, `dispatchReadyTasks`, `checkConvergence` and the final
  status all read `listTasks()` over the whole table. Old failed tasks made every later run end
  `failed`; an unrelated root created mid-run was dispatched and held convergence.

## Fix
- `db.ts`
  - `getStaleDispatches`: compare with `julianday()` on both sides (parses both shapes as UTC). No
    stored row is rewritten, no schema change — old rows stay readable.
  - `failDispatch`: only an active (`pending`/`dispatched`) context transitions (conditional
    `UPDATE ... AND status IN (...)`); otherwise returns `undefined` and changes nothing. The task is
    moved only while it is still `dispatched`.
  - New `failOrphanedCoordinatorRuns(ownedRunId?)`: marks every other `running` row `failed`
    (tasks/history untouched). Returns the retired ids, newest first.
- `orchestration-gates.ts`: track `activeRunId` with `activeCoordinator`. `run` retires unowned
  running rows before the single-run check (an owned live run is still refused). `runStop` retires
  orphans, stops the owned coordinator, and durably marks the row `failed` even without an in-memory
  instance. `assertExecutionAdmitted('agent-run')` stays the first statement.
- `db.ts` also gains `OrchestrationDb.openForProcess(path)` = open + retire every running row.
- `dobius-runtime.ts` (deviation, 2 hunks): `getOrchestrationDb()` opens via `openForProcess`
  (coordinators are process-local, so a running row found on first open has no owner); the
  agent-exit escalation now carries `dispatchId`.
- `coordinator.ts`
  - Run scope: `decompose` claims the non-terminal tasks present at start (throws the same
    "No tasks found" error when there are none); each tick adopts new tasks whose `parent_id` or deps
    point at an owned task. Ready-task dispatch, convergence, final status and `completedTasks` use
    only owned tasks. Terminal busy-detection and the concurrency count stay global (terminals are a
    shared resource).
  - Escalation: fails an attempt only if the task is owned and `dispatched`, the latest context is
    `dispatched`, the payload `dispatchId` (when present) equals it, and the sender is its assignee.
    Without a `dispatchId`, the message must be strictly newer than `dispatched_at` (same second is
    ambiguous and ignored). A no-op `failDispatch` is not logged as a retry.
- `preamble.ts` (deviation, 1 line): the worker's escalation command includes
  `--dispatch-id ${dispatchId}` (the CLI already supports the flag). Snapshot updated.

## Tests
- `orchestration/db.test.ts`: orphan retirement keeps tasks; duplicate failure counts once; late
  failure of an old attempt leaves the new attempt + task alone; failure doesn't reopen a completed
  task; stale check across midnight with SQLite-format rows (fresh-across-midnight, stale no
  heartbeat, recent heartbeat, stale heartbeat, after-midnight); fresh same-day dispatch keeps grace.
- `orchestration/coordinator.test.ts`: stale (old dispatchId), foreign-sender and pre-dispatch legacy
  escalations cannot fail the newer attempt; duplicate escalation counts once; two independent roots
  plus an old failed task converge independently (child adopted, unrelated root untouched, then its
  own run completes). Existing circuit-breaker test now escalates from the live attempt with its
  dispatchId; the two "send reconciled before read" tests start the run before the reconcile (their
  old setup completed the task before the run began, which is exactly the old-task case #65 removes).
- `rpc/methods/orchestration-gates-lifecycle.test.ts` (new): runStop and run past a running row left
  by a previous process without resetAll, owned run still refused, stop is durable.
- `db.test.ts` `openForProcess`: a file DB with a running row from a "previous process" is retired on
  open, tasks kept. (Testing through `runtime.getOrchestrationDb()` was not possible: its inline
  `require('electron')` bypasses `vi.mock`, so the logic moved into the DB factory.)

## Mutation checks (each broke the named tests, then restored; script in stabilize-run/026/mut)
- M1 stale check back to string compare → 2 db tests fail (midnight, same-day grace).
- M2 failDispatch unguarded → 3 db tests fail (duplicate, late old attempt, completed task).
- M3 escalation checks removed (dispatchId, sender, time) → stale/foreign/pre-dispatch test fails.
- M4 listOwnedTasks returns all tasks → two-roots test fails.
- M5 no linked-task adoption → two-roots test fails (child never dispatched).
- M6 run/runStop without orphan retirement + durable stop → lifecycle test fails.
- M7 openForProcess without retirement → openForProcess test fails.

## Verification
- `pnpm run typecheck` exit 0. oxlint + react-doctor clean on all changed files.
- Targeted: orchestration/*, orchestration.test.ts, orchestration-gates-admission/lifecycle tests:
  8 files, 234 passed, 2 skipped.
- Full suite: DEFERRED (note: an accidental `-u` invocation ran the whole suite once under heavy
  machine load; it changed only the intended preamble snapshot).

## Lessons
- `vitest run -u <file>` with a path that doesn't narrow as expected can still run the full suite and
  rewrite other snapshots; check `git status` afterwards.
- `require('electron')` inside a method is not intercepted by `vi.mock('electron')` here; put
  testable logic behind a plain factory.

## Deviations from EXECUTION-ORDER.md
- Touched `dobius-runtime.ts` (startup reconcile + `dispatchId` on the exit escalation) and
  `preamble.ts` (+ snapshot) outside the listed files; both minimal.
- No timestamp migration: normalising the comparison with `julianday()` fixes it for old and new rows
  without a schema change, which is strictly more additive than a column migration.
- Run ownership is in-memory in the Coordinator (claim at start + linked adoption) rather than a new
  `run_id` column: only one coordinator can run at a time and runs don't survive restarts, so a column
  would add a migration without changing behaviour.

## Review round 1 (findings F1-F3)
- **F1 [medium] one process retired another live process's run.** `openForProcess` (and `run`/`runStop`)
  retired every `running` row. Dev instances skip the single-instance lock (`index.ts` ~543) and share
  `appData/Dobius+-dev` (`configure-process.ts:221`), as does `DOBIUS_BYPASS_SINGLE_INSTANCE_LOCK=1`.
  - Schema v5 → v6 (additive): nullable `coordinator_runs.owner_pid INTEGER`, `owner_session TEXT`.
    `createCoordinatorRun` stamps `process.pid` + a per-process random session id (injectable via
    `new OrchestrationDb(path, owner)` / `openForProcess(path, owner)` for tests).
  - `failOrphanedCoordinatorRuns` now retires only: rows with a NULL/invalid owner (legacy, pre-v6:
    they predate this build, so retiring keeps the old recovery behaviour); rows of a dead pid
    (`process.kill(pid, 0)` → `ESRCH`; `EPERM` and any other error count as alive, fail closed); rows
    of this pid with another session (a reused pid); and rows of this process other than the owned
    run. A live other process's row is left `running`.
  - New `startCoordinatorRun` does retire + active check + insert inside `BEGIN IMMEDIATE`, so two
    processes sharing the DB cannot both pass the check. The refusal keeps the
    `Coordinator already running: <id>` prefix and adds `(owned by another live process, pid N)`.
  - `runStop` refuses a run owned by another live process (`must be stopped from that instance`)
    instead of marking it failed, since it cannot stop that loop.
- **F2 [low] stop then run could dispatch the same task twice.**
  - (a) `coordinator.ts`: `dispatchReadyTasks` returns if stopped after awaiting terminals (no worker
    terminal created either) and breaks the loop when stopped; `dispatchTask` re-checks `stopped` and
    `getTask(id).status === 'ready'` right before `createDispatchContext` (after the drift await).
    Note: `createDispatchContext` already threw on a non-ready task, so the status re-check turns a
    logged error into a quiet skip; the `stopped` checks are the behaviour change.
  - (b) `orchestration-gates.ts`: `unsettledLoops` tracks each loop until its promise settles; `run`
    refuses (`Coordinator run <id> is still stopping; retry once it has exited`) while a stopped loop
    is unsettled. Refuse chosen over await because the handler is synchronous and returns at once.
- **F3 [low] one-directional adoption.** `adoptLinkedTasks` also adopts the non-terminal
  dependencies of owned tasks, repeating to a fixpoint with the parent/deps rule.

### Tests (round 1)
- `db.test.ts` `openForProcess`: "retires dead, reused-pid and legacy owners; a live other process
  keeps its run" (live = `process.ppid`, dead = pid of an exited `spawnSync` child); "upgrades a v5
  DB additively; its ownerless running row is retired as legacy".
- `orchestration-gates-lifecycle.test.ts`: "leaves a run owned by another live process alone: run and
  runStop both refuse" (shared file DB, other instance = `process.ppid`); "refuses a new run until a
  stopped coordinator loop has exited".
- `coordinator.test.ts`: "adopts the unowned dependencies of an adopted task so the run converges";
  "a coordinator stopped while awaiting terminals dispatches nothing".

### Mutation checks (round 1; script in stabilize-run/026/mut2/run.py, originals restored)
- F1a foreign live rows always retired → db live-owner test + gates foreign-run test fail.
- F1b runStop owner check removed → gates foreign-run test fails.
- F2a all `stopped` checks in dispatch removed → stop-during-dispatch test fails.
- F2b `unsettledLoops` check disabled → still-stopping test fails.
- F3 dependency adoption disabled → adoption test fails.

### Verification (round 1)
- `pnpm run typecheck` exit 0; oxlint + react-doctor clean on all 7 changed files.
- Targeted (orchestration/*, orchestration.test.ts, gates admission + lifecycle): 8 files passed,
  1 skipped; 240 passed, 2 skipped. Full suite: DEFERRED.

### Decisions (round 1)
- Legacy NULL-owner running rows are retired (they predate this build).
- A stopping loop that never settles (e.g. a hung terminal send) blocks new runs until restart.
  This is deliberate (fail closed).

## Rollback
Revert the commits. v6 only adds two nullable columns; older code ignores them. Rows marked `failed`
by orphan retirement stay `failed` (correct under old code too).
