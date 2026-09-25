# REPAIR BUILD-036 — Conductor run lifecycle (#58 #59 #60 #61 + 009B/C stores)

## Root causes
- **#58 (#7)** `conductor.ts` `kick()` resolved when `startAgentRun` returned, which only means
  the run was *accepted*. The transcript chain then started the next turn while the first run
  was still working, so two paid runs resumed the same session at once. `currentRunId` was
  overwritten by the second run, so `stop()` stopped only the newest one. Both runs' callbacks
  set `currentRunId = null`, so the older run finishing late cleared the newer run's pointer.
- **#59 (A7)** The conductor records its turns as `source: 'channel'` (kept by BUILD-007 for run
  records and settingSources). It passed no `maxBudgetUsd`, so `agent-runner.ts` applied the
  implicit channel default of $1. A turn that hit it ended with `error_max_budget_usd`: the
  model never ran `dobius-reply`, so the phone poller got nothing, and only `lastError` (not
  exposed anywhere) held the SDK's error list.
- **#60 (A8)** `ensureAgentId()` returned any existing "Voice Conductor" agent untouched. The
  prompt, model and tools were written only at creation, so later code changes (including the
  BUILD-033 fail-closed `dobius-confirm` wording) never reached an existing install.
- **#61 (A9)** The system prompt says the work registry caps concurrent work at 1 and returns
  `{ok:false, error:"concurrency cap: 1/1 agents already running", retryable:true}`.
  `work-registry.ts` had no cap (its header said caps belong elsewhere), and `dobius-spawn`
  never touched the registry, so any number of spawned paid runs could be open.
- **Extra scope (009B/009C inventory)** `lead-tab-store.ts:53` and
  `persistent-work-registry.ts:38` did `try { JSON.parse(read) } catch { empty }`, and the next
  save renamed that empty value over the real file. Both also used the shared
  `<file>.<pid>.tmp` staging name.
- **Found while fixing #58**: `consumeRun` (`agent-runner.ts`) calls neither `onResult` nor
  `onRunEnded` when a stopped run's stream ends cleanly (no throw, no result), because the
  post-loop check only handles `status === 'running'`. Any caller that holds something until
  the run ends (the conductor chain, the spawn work slot, Asana `inFlightTriageGids`) would
  wait forever.

## Fix
- `conductor.ts` (engine):
  - `startTurn()` returns `{ settled }`, a promise that resolves only when the run ends
    (`onResult`, `onRunEnded`, or stop). The chain awaits `settled` before the next turn.
    (Wrapped in an object: awaiting a promise-of-a-promise flattens it.)
  - `ownedRuns: Map<runId, settle>` tracks every run this conductor started and has not seen
    end. `stop()` bumps `generation`, stops every owned run and settles it (so a stream that
    never reports can't wedge the chain), and rethrows the first stop error after all settle.
  - A run whose id arrives after `stop()` began (acceptance in flight) is stopped as soon as
    its id is known. Queued turns from an older generation never start; their request gets
    the reply "Voice Conductor was turned off before this request started."
  - Callbacks are per run and idempotent (`ended`). Only the current generation touches state,
    and `currentRunId` is cleared only when it still points at that run.
  - `postTranscript` resolves when this turn's run is accepted (same as before, so start errors
    still reach the RPC caller), or at once when it is queued behind a running turn (so
    `voice.intent` does not hang for minutes). A queued turn that fails to start reports it as
    the request's reply.
  - #59: `maxBudgetUsd: CONDUCTOR_MAX_BUDGET_USD` (2) is passed on every turn and shown in
    `getStatus()` (`maxBudgetUsd`, plus `queuedTurns`). `conductorTurnFailureReply()` maps
    `error_max_budget_usd` → "Voice Conductor stopped: this request reached its $2 spending
    limit before finishing.", `error_max_turns` → step limit, other errors → "could not finish".
    It is set as the request's reply only when the conductor has not already replied to it
    during this turn, and becomes `lastError`. A cancel stays quiet.
- New `conductor-agent.ts` (#60): constants and the agent find/create moved out of
  `conductor.ts` (max-lines). Managed fields = `systemPrompt`, `model`, `allowedTools`.
  - A sidecar record `userData/voice-conductor-agent.json` (SafeJsonFile) stores, per agent id,
    the sha256 of the value this code last wrote to each field.
  - `planManagedFieldMigration` (pure): a field equal to the current default is left; a field
    equal to the last-applied hash, or to a known shipped value (`LEGACY_MANAGED_HASHES`: the
    prompts from git `caee2df0` and `4df99594`) is updated; anything else is a user edit and is
    kept (logged by field name only).
  - A record for another agent id is ignored. An unreadable record leaves the agent unchanged
    (a user edit can't be told apart without it).
  - Legacy hashes were computed by evaluating the prompt template from each commit
    (`stabilize-run/036/hash.cjs`). A test rebuilds the pre-036 prompt by reversing this build's
    edits and checks its hash is in the list.
- `work-registry.ts` (#61): `MAX_RUNNING_WORK = 1`. `track()` returns
  `{ok:true} | {ok:false, error, retryable:true}` and refuses a new item while another is
  running (re-tracking the running item itself is an update). `capacityError()` exposes the
  check. The reservation is saved first and committed only if the save succeeded; a release
  (`markDone`) is applied in memory even if its save fails. A running `kind: 'spawn'` item
  can't be replaced by `dobius-track`.
- `agent-spawn.ts` (#61): reserves a `kind: 'spawn'` item synchronously before the only
  `await` (so two concurrent spawns can't both pass) and throws `ConductorWorkCapacityError`
  when refused. The slot is released on success, error result, `onRunEnded` (error or
  cancelled) and a failed start. A worker that hits its budget is reported as "stopped: it
  reached its spending limit for this run" instead of an empty error list.
- `conductor-cli-routing.ts`: `/trackWork` returns the refusal body the prompt documents.
  `/spawn` checks `capacityError()` before asking Carson, and maps a slot lost during approval
  to the same retryable body. `/markDone` refuses (409) to release a running spawned item by
  hand.
- `persistent-work-registry.ts` / `lead-tab-store.ts`: `SafeJsonFile` (mode 0600, unique temp,
  quarantine copy, reads never write). A malformed row/entry makes the file unreadable instead
  of being dropped. Saves use `save()`, which throws on refusal (both old writers threw on a
  write failure). A spawn item still `running` at load is marked `error` ("interrupted:
  Dobius+ restarted before the run finished"): its completion callback died with the process.
- `conductor-system-prompt.ts` (#61): documents the real cap (tracked item or spawned run; the
  spawn refuses before asking) and says to run `dobius-track` BEFORE `dobius-send`, stopping on
  `ok:false`. Otherwise the send happens before the refusal.
- `agent-runner.ts`: `else if (!sawResult && run?.status === 'cancelled') onRunEnded('cancelled',
  'stopped by user')` after the stream loop.
- `service.ts`: passes the work registry to the spawner. `types.ts`: status and registry types.

## Tests
- `conductor.test.ts` (extended; `conductor-agent` partially mocked, real module via importActual):
  - #58 rapid transcripts never overlap (3 turns; the 2nd starts only after run-1's result, the
    3rd only after run-2's `onRunEnded`; `queuedTurns` = 2); a late callback from run-1 doesn't
    clear run-2 or set `lastError`; stop stops the open run, a run accepted during stop, and every
    queued turn; the chain works again after restart.
  - #59 `maxBudgetUsd` passed and shown; budget exhaustion reply + lastError; an existing
    conductor reply is kept; outcome mapping.
  - #60 pre-036 prompt hash is legacy and migrates with no record; unknown prompt without record
    is kept; untouched prompt/tools updated while the user's `model: 'sonnet'` is kept, record
    rewritten; prompt edited after the last migration kept; record for another agent ignored;
    unreadable record → no update, no write.
- `agent-spawn.test.ts` (extended): second spawn refused while the first is open, admitted after
  it ends; two simultaneous spawns admit one; release on error result / onRunEnded error /
  cancelled / failed start; budget message. Routes: `/trackWork` + `/spawn` refused without
  asking Carson; slot lost during approval → retryable; `/markDone` won't release a spawn item.
- `work-registry.test.ts` (extended): cap + re-track + release; no reservation when the save throws.
  Two existing status tests now mark the first item done before tracking a second.
- `persistent-work-registry.test.ts` / `lead-tab-store.test.ts` (extended): truncated file kept
  byte-identical with an `.unreadable-*` copy and the save refused; one malformed row/entry →
  unreadable; restart releases a running spawn item.
- New `agents/agent-runner-cancel-end.test.ts`: real runner, stream that ends cleanly on abort →
  `onRunEnded('cancelled', 'stopped by user')` once, no `onResult`.
- Fakes updated: `cli-server.test.ts` (status fields, `track` result, `capacityError`),
  `conductor-approvals.test.ts` (`capacityError`).

## Mutation checks (stabilize-run/036/mut.py; each file restored and byte-compared)
All 24 mutations broke at least one test (no survivors):
- #58: M1 chain awaits only acceptance (2 fail) · M2 `end()` not idempotent (late callback) ·
  M3 stop skips owned runs · M4 run accepted during stop not stopped · M5 queued turn starts after stop.
- #59: M6 no explicit `maxBudgetUsd` · M7 no failure reply (2) · M8 failure reply overwrites the
  conductor's own reply.
- #60: M9 migration overwrites user edits (4) · M10 legacy prompt hash dropped · M11 record for
  another agent used · M12 unreadable record ignored.
- #61: M13 no cap (6) · M14 spawn ignores a refused reservation (2) · M15 no release on
  `onRunEnded` · M16 no release on failed start · M17 `/spawn` asks before the cap check ·
  M18 `/markDone` releases a spawn item · M19 reservation committed before save ·
  M20 interrupted spawns not released on load.
- Stores: M21 work file drops bad rows · M22 lead tabs drop bad entries · M23 lead tabs swallow
  a refused save.
- Runner: M24 no `onRunEnded` on a clean end after stop.

## Verification
- `pnpm run typecheck` exit 0.
- `src/main/voice-conductor src/main/agents src/main/dobius-cli src/main/imessage-bridge
  src/main/storage src/main/runtime/rpc/methods/voice-conductor.test.ts`: 52 files, 700 tests green.
- oxlint + react-doctor clean on every changed file except `agent-runner.ts` `max-lines`
  (pre-existing: 494 at base, 496 now; a split is out of scope).
- Full suite: DEFERRED (coordinator).

## Deviations from EXECUTION-ORDER.md
- Files beyond the list: `conductor-agent.ts` (new; keeps `conductor.ts` under max-lines),
  `conductor-cli-routing.ts` (the documented refusal body, pre-approval cap check, spawn-item
  mark-done guard), `persistent-work-registry.ts` + `lead-tab-store.ts` (brief extra scope),
  `service.ts` (wiring), `types.ts`, `agents/agent-runner.ts` (the 3-line cancelled-end hook:
  without it a stopped run can hold the conductor chain or the work slot forever), and the fakes
  in `cli-server.test.ts` / `conductor-approvals.test.ts`.
- New test file `agent-runner-cancel-end.test.ts` (runner mocks don't fit `conductor.test.ts`).
- #59 "enforced identically across providers": the conductor is Claude-only. A Codex conductor
  is already refused (`codex-run-policy.ts`: non-manual profile), and the explicit budget is a
  second reason it is refused. No Codex budget path was added.
- #59 "displayed": exposed in `VoiceConductorStatus` and in the exhaustion reply. There is no
  conductor status UI today; adding one is a UI feature, out of scope.
- #61 for tab dispatch is prompt-level: `/tabSend` (C3, by design) can't be tied to a reservation,
  so the host enforces the cap on `dobius-track` and `dobius-spawn`, and the prompt now reserves
  before sending.
- The brief's note "#59 managed-field migration" is #60 in the matrix; implemented as #60.
- `postTranscript` resolves at queue admission when a turn is already running (see Fix).

## Decisions for Carson
- Conductor per-turn budget is **$2** (was an implicit $1 channel default). Change
  `CONDUCTOR_MAX_BUDGET_USD` in `conductor.ts`.
- Work cap stays at **1** (as the prompt promised): one tracked item or one spawned run at a time.
  A tracked tab item holds the slot until `dobius-mark-done` (text "cancel"/mark it done).
- A spawned run can't be released by `dobius-mark-done`; it frees the slot when it ends. A spawn
  still open when Dobius+ quits is marked failed at the next start.
- Migration: an unedited prompt/model/tools gets the new defaults at each conductor start; an
  edited field is kept. If the record file is unreadable, nothing is migrated.

## Rollback
Revert the commit. `voice-conductor-agent.json` is new and ignored by older code. Work items
gain an optional `kind` field that older code drops on load (old code had no cap).

## Lessons
- `await` on a function returning `Promise<Promise<T>>` flattens it; return `{ settled }`.
- A "wait until the run ends" contract needs an end signal on every path, including a clean
  stream end after cancel; check the runner before relying on callbacks.
- A cap enforced by tracking after the side effect is advisory; reserve before acting.
