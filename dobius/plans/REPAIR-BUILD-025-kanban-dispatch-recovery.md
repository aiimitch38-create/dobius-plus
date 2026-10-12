# REPAIR BUILD-025 — Kanban dispatch recovery (#94, N9)

## Root causes
- **N9** `renderer/.../kanban/board-dispatch.ts` `dispatchTask` did `inFlight.add(task.id)` and then
  `await window.api.vertexTasks.update(claim)` *outside* the `try/finally` that releases the slot.
  A rejected claim write (read-only board after BUILD-010, save failure) left the id in `inFlight`
  for the life of the renderer: the task was skipped by every later poll, and one of the two
  dispatch slots was lost. `poll()` called `void dispatchTask(...)` with no rejection handler, so
  the same rejection was also an unhandled rejection. A claim that resolved `null` (task gone) went
  on to launch a paid run with no stored claim.
- **#94** a claim is `dispatch.status = 'running'` on the card. Only the renderer promise that made
  it settles it. If the app (main or renderer) dies between claim, launch and settle, nothing ever
  rewrites it: the card says "<agent> is working on this" forever, and `isReady` only re-dispatches
  `failed` cards, so moving it back to To Do does nothing. Nothing recorded which process held the
  claim, so no later read could tell a dead claim from a live one (dev instances share userData
  without a single-instance lock).
- Found while tracing the crash path: `dobiusCommunications.ts` `reviveInterruptedChannelRuns`
  re-kicks every interrupted `source: 'channel'` run after a restart. Board runs are channel runs,
  so after a crash the board task was silently re-run through `startDobiusChannelRun`, which passes
  **no budget cap**, and the card never heard about it. That is an automatic relaunch of a paid run.

## Fix
- `board-dispatch.ts`: claim write moved inside the `try/finally`, so every exit (claim rejected,
  claim `null`, run failed, settle failed) frees the slot. `null` claim returns without launching.
  `poll()` attaches `.catch` to each `dispatchTask`. `MAX_ATTEMPTS` now comes from the shared
  constant; the prompt's first words come from `BOARD_TASK_PROMPT_LEAD`.
- `shared/vertex-task-types.ts`: `VertexTaskDispatch.ownerPid` / `ownerSessionId` (optional) and
  `VERTEX_DISPATCH_MAX_ATTEMPTS = 2` (was a renderer-local constant).
- New `main/vertex/vertex-dispatch-recovery.ts`:
  - `stampClaimOwner(patch)`: on every `update`, the store strips any owner fields the renderer sent
    and, for a `running` dispatch, stamps `{pid: process.pid, sessionId: <random per process>}`.
    Settled dispatches carry no owner.
  - `readReleasingOrphanedClaims(read, save, gap)`: used by `list()` and `reload`. A `running`
    claim is orphaned when it has no owner (written before this build), its pid is this process's
    pid with another session id (earlier process, reused pid), or its pid is dead (`isPidAlive`,
    ESRCH only). A live other process's claim is left alone. An orphan becomes `failed` (or `dead`
    once `attempts >= 2`, same rule as a failed run) with error "Interrupted: Dobius stopped before
    this run finished. Move to To Do to retry." Owner fields are dropped. A card sitting in To Do
    is moved to In Progress so nothing re-dispatches it without a new operator move. It is saved in
    one write; if that write fails the board still loads (on-disk view, warning logged) and the next
    read retries. Never relaunches anything.
  - Reconciliation runs on every `list()` (not only at startup) so a claim of a dev instance that
    crashes while this one is running also converges within one board poll. Cost: one
    `kill(pid, 0)` per running card per read.
- `isPidAlive` comes from `main/lib/is-pid-alive.ts` (moved there by BUILD-024 out of
  `runtime/orchestration/db.ts`, BUILD-026). An earlier commit of this build had moved it to `runtime/process-liveness.ts`; that file was dropped on merge.
- `dobiusCommunications.ts`: exports `BOARD_TASK_PROMPT_LEAD`; revival skips runs whose prompt
  starts with it (one line, same shape as BUILD-023's iMessage guard).

Operator retry after a crash: card shows "failed — move to To Do to retry"; moving it to To Do
makes `isReady` true (`failed && attempts < 2`), and the next poll dispatches it once.

## Tests (each seen FAIL with its guard removed, PASS with it)
- `kanban/board-dispatch.test.ts` (extended; mocks `runDobiusBoardTaskInChannel` and `getChannels`):
  rejected claim frees the slot (next poll claims again); rejected claim from `poll` is handled, no
  `unhandledRejection`; `null` claim never launches; a claimed run settles into Review.
- `vertex/vertex-task-store.test.ts` (extended, temp dir, `process.kill` stubbed for two fixed pids):
  dead-pid claim → failed on disk, attempts kept, owner dropped, operator can move it to To Do;
  live other pid → still running; same pid + other session → failed; no owner → failed; attempts 2
  → dead; orphan in To Do → In Progress; recovery write fails (read-only dir) → board still lists,
  then converges once writable; renderer-forged owner replaced by this process; settle drops owner.
- `communications/shared/api/reviveInterruptedChannelRuns.test.mjs` (extended): a board-task run is
  not revived (one test because revival runs once per module load).

Mutation checks (scripted, each restored): no slot release in finally (M1); no `.catch` in poll
(M2); launch despite null claim (M3); reconciliation disabled (M4, 6 tests fail); liveness ignored
(M5); session id ignored for own pid (M6); owner not stamped (M7); orphan left in To Do (M8); spent
attempts not dead-lettered (M9); ownerless legacy claims kept (M10); revival guard removed (M11);
recovery-write failure rethrown (M12). Every one failed at least one test.

## Verification
- `pnpm run typecheck` exit 0.
- Targeted vitest (after review fixes: + `src/main/agents`, `src/main/ipc/vertex-tasks.test.ts`, `agents-hub`; 40 files passed, 1 skipped; 660 passed, 2 skipped). First commit: `src/main/vertex`, `src/renderer/src/components/kanban`,
  `src/main/runtime/orchestration`, `dobius-tool-server.test.ts`,
  `reviveInterruptedChannelRuns.test.mjs`, `dobiusCommunications.test.mjs` → 13 files passed,
  1 skipped; 277 passed, 2 skipped.
- Full suite: DEFERRED (coordinator).
- oxlint and react-doctor config clean on every changed file except `dobiusCommunications.ts`,
  which has the same 127 pre-existing default-config errors before and after (none on added lines).
  `vertex-task-store.ts` stays under `max-lines` because the recovery logic lives in its own file.

## Deviations from EXECUTION-ORDER.md
- Files outside the spec: new `main/vertex/vertex-dispatch-recovery.ts` (keeps the store under
  max-lines), shared liveness from `main/lib/is-pid-alive.ts` (BUILD-024; `db.ts` now identical to integration,
  as the brief asked), `shared/vertex-task-types.ts` (owner fields + shared max attempts),
  `dobiusCommunications.ts` (revival guard + exported prompt lead).
- Reconciliation runs on every read, not only at startup (covers another instance crashing later).
- Not linked to the agent run id / BUILD-023 lease: the board only learns the run id when the run
  ends (`runDobiusBoardTaskInChannel` does not expose it), and the lease is memory-only. Ownership is
  the main process, which is the lifetime of every agent run.
- Renderer-side loss (review F1) is handled by per-window claim tracking (below), not by run ids.
- New IPC `vertexTasks:releaseInterruptedClaims` (main `ipc/vertex-tasks.ts`, preload, api-types) and
  `ipc/vertex-tasks.test.ts`, outside the spec's file list.

## Decisions for Carson
- An interrupted claim becomes a failure that uses up its attempt (2nd interrupted attempt =
  dead-lettered), the same as a failed run, because the interrupted run may already have spent money.
- Interrupted board runs are no longer auto-revived after a restart; the card asks for a manual retry.
- Claims written before this build (no owner) are released on first read. **Transition cost
  (review F3):** if an older installed build is running at the same time on the same profile and is
  mid-run, the new build marks that live card failed; the old build's settle write still lands
  afterwards and overwrites it. Running several instances on one profile is unsupported; this is
  accepted rather than guessed around (an owner-less claim cannot be told apart from a crashed one).
- Age cap `CLAIM_MAX_AGE_MS` = 6 hours (review F2), for claims of another live pid only.
- After a window reload the run goes on in main; the card now stays "working" until that run ends and
  then shows its real outcome (review round 2). A failed/cancelled run is recorded as failed with the
  run's own reason, although the live dispatcher (pre-existing) records any finished run as succeeded.

## Review fixes (third commit)
- **F1 (medium)** a claim of THIS process stayed "running" while main lived if the renderer reloaded
  or crashed, or the settle write rejected (no promise left to settle it). Now:
  - `vertexTasks:update` runs the store update inside `withClaimingWindow(event.sender.id, ...)`
    (in `vertex-dispatch-recovery.ts`), so a claim is stamped with the calling window
    (`ownerWebContentsId`; a renderer-sent value is replaced; in-process callers stamp none).
  - Every dispatcher poll first calls `vertexTasks:releaseInterruptedClaims({activeTaskIds})` with
    its in-flight set (even while paused; it launches nothing). Main runs `list()` inside
    `withLostClaimCheck(check, ...)` and ends as failed/dead
    ("Interrupted: the window that started this run reloaded or lost track of it. Move to To Do to
    retry.", out of To Do, same path as crash recovery) every claim of this process + session that
    is either (a) the caller's window and not in its in-flight set (a reloaded window's set starts
    empty; a failed settle already left `inFlight`), or (b) another window that is gone or crashed
    (`webContents.fromId`). A live other window's claims are left alone.
  - Why this and not run ids: the run id is only known when the run ends
    (`runDobiusBoardTaskInChannel`), so stamping it needs a change to the 4.4k-line vendor module;
    the in-flight set is already the exact "still awaited" truth.
  - The underlying agent run may still be live in main after a reload. The operator sees
    "Interrupted" and can retry by hand; that starts a second run. Nothing is relaunched automatically.
  - With auto mode off the dispatcher never polls, so such a claim converges when auto mode is turned
    on, or at the next restart.
  - Both helpers set a module variable around one synchronous store call and clear it in
    `finally`. This keeps `vertex-task-store.ts` under max-lines and the shared `VertexTaskSource`
    signature unchanged.
  - An earlier draft also stamped a per-load dispatcher id. It was removed: mutation showed it
    redundant (a reloaded window's in-flight set never holds an old claim, and a running card is never
    re-claimed).
- **F2 (low)** a crashed instance's pid reused by an unrelated live process kept its claim forever.
  Claims of another live pid are now released once `updatedAt` is older than `CLAIM_MAX_AGE_MS` =
  6 hours. Board runs are capped at $3 and 30 turns but not by time; 6 hours is several times what
  such a run should take (an estimate, not measured), so a live run is very unlikely to be cut. If one
  is, its own settle write still lands afterwards. Own-process claims are not aged; F1 covers them.
- **F3 (low)** documented under Decisions (transition cost; one profile, one instance).
- Tests: `vertex-task-store.test.ts` (age cap; window stamp; lost claim released; awaited claim kept;
  other live window kept, closed window released), `board-dispatch.test.ts` (each poll reports the
  in-flight set), new `ipc/vertex-tasks.test.ts` (update uses the sender window; release scoped to
  the sender; crashed/destroyed/missing windows are not live; malformed requests ignored).
- Mutations (each failed at least one test, then restored): no age cap; in-flight set ignored
  (never release / always release); other windows released regardless; lost-claim release removed;
  window not stamped; window or check not cleared after its call (leak); poll skips the release call; IPC ignores the sender; IPC skips validation;
  crashed window counted live.

## Review fixes, round 2 (fourth commit, after merging stabilize/integration)
- **F1 (medium)** the board run executes in main (`agent.run`) and outlives a reloaded or closed
  window, so ending its claim as "Interrupted" invited a second paid run and the result never reached
  the card.
  - Run id stamped at launch: `runDobiusBoardTaskInChannel` takes `onRunStarted(runId)` and awaits it
    right after `agent.run` returns, before waiting on the run. `board-dispatch.ts` uses it to write
    `{...claim, runId}` (awaited, so it can never land after the settle write; a failed stamp only
    logs). Main's `stampClaimOwner` keeps `runId` and restamps the owner.
  - `lostClaimEnd` in `vertex-dispatch-recovery.ts`, used only on the lost-claim path (this process +
    session, window gone or task not awaited): with a run id, look it up in `agent-runs-store`. While
    it is `running`, keep the card running. Once it has settled, end the card with the real outcome:
    `success` → `succeeded`, report = run summary (4000 chars), cost, card to Review (the record the
    dispatcher itself writes); `error`/`cancelled` → `failed`/`dead` with "The run ended (<status>):
    <summary>". Without a run id (window lost between launch and stamp, or a claim from before this
    commit): keep the card while any `running` run of `dispatch.agentId` started at or after the claim
    time (`dispatch.updatedAt`, unchanged by the stamp) exists; afterwards end it as "Interrupted",
    because the time match cannot prove which run it was.
  - Chosen option: the next poll writes the outcome (no main-side watcher). Cost: a closed-window run
    is written when some window's dispatcher polls next (15 s). With auto mode off it waits for auto
    mode or the next restart; after a restart the runs store has marked it `error` / "app restarted
    during run", and the crash path ends the card.
  - Not applied to the other-process or same-pid-other-session orphan paths: `agent-runs-store` is a
    per-process cache that turns every `running` row into `error` on load, so another process's runs
    cannot be trusted from here, and a previous session's runs are all dead.
  - Tests: `vertex-task-store.test.ts` (runs store mocked): live run keeps the card; settled success
    gives Review + report + cost; failed run gives failed with its reason; without a run id a newer
    running run of the agent keeps it, an older one does not. `board-dispatch.test.ts`: the run id is
    written to the claim before the run is awaited. New `runDobiusBoardTaskInChannel.test.mjs`:
    `onRunStarted` runs after `agent.run` and before the first `agent.runs` poll.
  - Mutations (each failed at least one test, then restored): lost path ignores runs; a running run is
    released; a settled run treated as interrupted; success not recorded; no agent+time fallback;
    fallback ignores the claim time; no run-id stamp; `onRunStarted` never called.

## Rollback
Revert the commits. Data: new optional fields `ownerPid`/`ownerSessionId`/`ownerWebContentsId` on running dispatches;
older builds ignore them. No file format or schema change.

## Lessons
- A slot/lock taken before an await must be inside the same try/finally as that await.
- A durable "running" marker needs a durable owner, or nothing can ever prove it is stale.
