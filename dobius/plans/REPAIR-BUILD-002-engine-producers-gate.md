# REPAIR BUILD-002: engine producers honor the "Pause crew" gate (Upstream)

Bug N13 (ARCHITECTURE-MAP §5.1 rows 5 and 13). Depends on BUILD-001 (`agents/execution-gate.ts`).

## Root cause
- `automations/service.ts` `evaluateAutomation` (scheduled tick, called from `evaluateDueRuns` on the interval, on `start()` and on `setRendererReady()`) went straight from the missed-grace check to `requestDispatch`, which sends `automations:dispatchRequested` (renderer) or calls the headless dispatcher. Nothing consulted the pause gate.
- `runtime/rpc/methods/orchestration-gates.ts` `orchestration.run` created a `Coordinator`, inserted a `coordinator_runs` row and started the dispatch loop without consulting the gate.

## Fix (one import + one check per site)
- `service.ts`: scheduled path only. After the run row is created, `checkExecutionAdmission('agent-run')` runs (skipped when the run is already outside the grace window). When blocked, the run is recorded `skipped_unavailable` with the gate's message ("Crew is paused. Resume it on the Agents page…" or the unreadable-control-file text), `nextRunAt` is advanced exactly like the missed path, and nothing is dispatched. `runNow` (manual, human-initiated) is untouched.
- The check was folded into the existing skip branch (shared `updateAutomationRun` + `advanceAutomationNextRun`) instead of a second copy-pasted block: a separate block pushed the file to 304 counted lines (max-lines 300); the folded form keeps it under the limit without a file split.
- `orchestration-gates.ts`: `assertExecutionAdmitted('agent-run')` is the first statement of the `orchestration.run` handler, before `getActiveCoordinatorRun`, `new Coordinator` and `createCoordinatorRun`. It throws `ExecutionBlockedError`; the RPC layer returns it as an error to the caller.

## Scheduling after a skip
`advanceAutomationNextRun(id, now)` sets `nextRunAt` to the next occurrence after `now`, so a paused tick records one skipped row per occurrence and does not re-fire on later ticks. Covered by the test (a second tick 60 s later creates no new row, nextRunAt = next day 09:00).

## Tests
- New `src/main/automations/service-admission.test.ts` (gate mocked like `asana-auto-mode-admission.test.ts`): paused scheduled tick → one `skipped_unavailable` row with "Crew is paused", no send, nextRunAt advanced, no re-fire on next tick; paused manual `runNow` still sends `automations:dispatchRequested`; unpaused scheduled tick dispatches as before.
- New `src/main/runtime/rpc/methods/orchestration-gates-admission.test.ts`: uses the REAL gate + config store with a temp `agents-config.json` `{agentsPaused:true}`; `orchestration.run` throws /Crew is paused/, `createCoordinatorRun` never called, no active coordinator row.

## Mutation checks
- `service.ts` guard disabled (`if (false && !admission.allowed)` in the first form; `admission` forced to `{allowed:true}` in the final form) → the paused-tick and paused-runNow tests fail.
- `orchestration-gates.ts` assert removed → the orchestration admission test fails.
- All restored; targeted tests green afterward.

## Deviations from EXECUTION-ORDER.md
- Orchestration test lives in a new file `orchestration-gates-admission.test.ts` rather than inside `orchestration.test.ts` (that file already carries a max-lines disable and does not mock electron; the real-gate test needs an electron `app.getPath` mock).
- No new `ExecutionOrigin`: both sites use `'agent-run'` (autonomous) per the build brief.

## Notes for later builds
- In tests without an electron mock, `checkExecutionAdmission` fails closed ("Crew control state could not be read") because `app` is undefined. Any future test that drives `orchestration.run` must mock electron or the gate.
- `automation.runNow` is also reachable over the runtime RPC/CLI; it stays allowed because it is an explicit human trigger (per brief).

## Rollback
Revert the commit. Runs already recorded as `skipped_unavailable` stay in history (truthful).
