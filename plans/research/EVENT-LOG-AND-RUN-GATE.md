# One event log, one writer, and a run gate (plan 8.1 + 8.11)

Research only. No app code changed. Written 2026-11-21 by the research worker for task `task_a463f70bfd87`.

Read first: `plans/WORKSTATION-BUILD-PLAN.md` (Phase 8, rows 8.1 and 8.11), `plans/DOBIUS-AGENTIC-BUILD-PLAN.md` (Tier B: B2, B3, B6), and `plans/research/AGENT-ACTIVITY-FEED.md`.
The brief also named `plans/research/IRIS-PLAN-AUDIT-20261121.md`. It is not in this checkout (see open questions).

## Plain-English terms

- **Ledger** (a record book of what happened, and what state each item is in).
- **Event log** (an append-only list of things that happened; lines are added, never edited).
- **Writer** (the one piece of code allowed to add to a record book). One writer means one place to fix bugs and one place to check ordering.
- **Gate** (a check that stops an action unless a condition is met).
- **Managed run** (an agent run that is supposed to be tied to a task, a project and a worktree).
- **Choke point** (a function every run must pass through, so a check placed there cannot be skipped).

## What I checked

Every fact is read from the workstation source (`/Users/bayou/Projects (Code)/dobius-plus/WB-plan2-research2/dobius/src/main`), unless marked otherwise. Paths below are relative to `dobius/src/main/`.

## Findings

### 1. Today there are four separate record books (verified)

| Record book | Where it lives | Format | Writer |
|---|---|---|---|
| Agent run list | `agents/agent-runs-store.ts:11` (file `agents-runs.json`), cap `MAX_RUNS = 50` at `:12` | JSON via `SafeJsonFile` | run store |
| Run event journal | `agents/agent-run-event-journal.ts` (file `agent-events.ndjson`, per the feed doc) | append-only JSON lines | `agents/agent-run-events.ts:25` (only caller) |
| Asana dispatch ledger | `agents/asana-dispatch-ledger.ts:7` (file `asana-dispatch-ledger.json`), path at `:31` | JSON file | Asana auto-mode and dispatch functions (`claimTask`, `recordBuildDispatched`, etc.) |
| Cloud job ledgers | `automations/cloud-jobs/database.ts` (SQLite via `node:sqlite`), plus `cloud-job-adam-outbox.ts`, `cloud-worker-start-ledger.ts`, `cloud-worker-host-ledger.ts` | SQLite and JSON | cloud job modules |

So a single run touches up to three of these. Nothing ties them together.

### 2. The journal already has one writer, and it sits on the right seam (verified)

- `agents/agent-run-events.ts` `broadcastRunEvent()` is the single fan-out point. It (a) appends to the journal, (b) notifies listeners, (c) sends to every window. Journal writes go through `appendAgentRunJournalEvent` at `:25`, and nothing else calls it.
- A reader already exists: `agents/agent-run-event-delivery.ts` (drains the journal, posts to ADAM, keeps a bookmark). The feed doc says ADAM has not been reachable since 2026-10-23, so this reader is stalled (from the feed doc; not re-verified here).
- The journal file opens with a torn-tail repair (`agent-run-event-journal.ts`, `terminateTornTail`, around lines 36-50). Good for crashes.

### 3. The journal has no replay cap, so that plan anchor is stale (verified)

The plan's B3 entry says "journal replay cap (`agent-run-event-journal.ts:104,115`)". That file is 113 lines long. It has only append (`:87`), an idle wait (`:110`), and the torn-tail reader. No replay or cap logic exists in it. Treat the B3 "replay cap" bug as unverified until someone finds the replay code elsewhere.

### 4. The run gate only checks "is the crew paused?" (verified)

- `agents/execution-gate.ts:30` `checkExecutionAdmission(origin)`:
  - `agents-page` is always allowed (`:31-33`).
  - Otherwise it allows the run unless the crew is paused or the control file is unreadable (`:35-61`).
- It takes an origin (`'agents-page' | 'agent-run' | 'dispatch-build' | 'imessage-command'`, `:5`), not a task. Nothing in it looks at the run's `AgentRunContext`.
- Callers (verified by grep): `agent-runner.ts:315,380` (via `assertExecutionAdmitted`), `runtime/orchestration/coordinator.ts:657`, `runtime/dobius-runtime.ts:12567`, `automations/service.ts` (3 places), `automations/loop-runner.ts:248`, `imessage-bridge/bridge-service.ts:307`, `agents/asana-auto-mode-service.ts:225`, and others.

So the existing gate is a pause switch. It is not a "this run belongs to a task" check. Plan item 8.11 is about the second thing.

### 5. `AgentRunContext` is optional everywhere, and no caller sets it (verified)

- `shared/agents.ts:113` `AgentRunContext` = `{ correlationId, adamJobId?, adamTaskId?, projectId?, worktreeId?, requestedBy? }`. Every field except `correlationId` is optional.
- `startAgentRun` is at `agents/agent-runner.ts:306`. Its context defaults to `{ correlationId: runId }` at `:356` and again at `:482`. The plan's anchors (`:296,340,474`) are about 10 lines stale.
- There are 11 callers of `startAgentRun` outside tests. I grepped each file for `context:` and for `adamTaskId` / `adamJobId`. None passes a context or an ADAM id:
  - `runtime/rpc/methods/custom-agents.ts:147` (the `agent.run` RPC)
  - `agents/asana-auto-mode-service.ts:155`
  - `voice-conductor/conductor.ts:148`
  - `agents/agent-channel-service.ts:138`
  - `agents/agent-heartbeat-service.ts:180`
  - `voice-conductor/agent-spawn.ts:122`
  - `ipc/agents.ts:146`
  - `communications/workflows/workflow-executor.ts:60`
  - `communications/providers/claude-agent-sdk-provider.ts:36,52`
  - `communications/providers/codex-cli-provider.ts:29,48`
- The Asana dispatch path (`agents/agent-tools/dispatch-build-handler.ts`) has its own gate (`:99`, `checkExecutionAdmission('dispatch-build')`) and its own task claim (`mayDispatchBuild(gid)` at `:139`). It is not a `startAgentRun` caller. So the task id is checked at dispatch, then lost before the run starts.

Result: the context field exists, but it is never filled in. The boundary check the plan wants has no data to check.

### 6. `agent-runner.ts` is the real choke point, and it is shared (verified)

- Every agent run started through `startAgentRun` (`:306`) passes `assertExecutionAdmitted(origin)` at `:315` and `:380`. `origin` defaults to `'agent-run'` (`:314`). Orchestration work is different: `runtime/orchestration/coordinator.ts:657` checks admission itself and does not call `startAgentRun`. So there are two entry points, not one.
- Run events fan out through `agent-run-events.ts`, which is imported by `agent-runner.ts`, `agent-headless-permissions.ts`, and both communications providers.
- The audit note in the brief is right: `agent-runner.ts` is shared. A change there reaches every caller at once.
- The plan says hooks cannot enforce anything (`hook failures return 204 by design`). That is in the plan (B2) and was not re-checked here.

### 7. Items I could not verify here

- "21,135 events vs 33 evidence rows, 0 approvals" (plan B6). This needs the live database. I did not open it.
- The plan's `orchestration-gates.ts:49,89` orphaned-row claim. Line 89 does call `assertExecutionAdmitted('agent-run')`. I did not trace the orphan-row bug.
- `plans/research/IRIS-PLAN-AUDIT-20261121.md` (missing from this checkout).

## Recommended design

### A. One writer, built on the existing journal

- Keep the journal (`agent-run-event-journal.ts`) as the event log's file. It already has a single writer and crash-safe tail repair. Don't add a new bus for v1.
- Make `broadcastRunEvent()` (`agent-run-events.ts`) the only function that writes run events. The feed (8.10) reads the journal and does not write its own copy.
- Ledgers that hold state (Asana claims, cloud jobs) keep their storage for now. They should also append a short event to the journal on each state change (claim, dispatch, fail, done). That gives one timeline without moving their state. Moving their state into the log is a bigger job (see task list, L).
- Keep the single bookmark for each reader (delivery to ADAM and the feed projector each keep their own cursor file). This is already the pattern.

### B. A gate at the choke point, not in callers

- Add a check at `agent-runner.ts:315` (next to `assertExecutionAdmitted`): if `origin` is managed (`agent-run`, `dispatch-build`, `imessage-command`), `options.context` must carry `adamTaskId` (or `adamJobId`) and `projectId`. Otherwise refuse the run with a clear message.
- Add an explicit `unmanaged` mode for the one legitimate exception (read-only discovery or manual use from the Agents page). Make the `agents-page` origin the only way to get it.
- Fill the context at each of the 11 callers before turning the check on. Turning it on first would break every heartbeat and channel run. Do it in one batch, with a test that fails if a managed caller passes no context.
- Keep `checkExecutionAdmission` as is (it is the pause switch). The new check sits beside it, not inside it.

### C. Sequence

1. Event writer and the ledger events (A).
2. Fill context at each caller (B, part 1). No behavior change yet, just data.
3. Turn on the context check in `agent-runner.ts` with an `unmanaged` escape (B, part 2).

## Task list

Sizes: S = under half a day, M = one to two days, L = longer.

1. (S) Confirm and pin the journal as the single run-event writer. Add a test that `appendAgentRunJournalEvent` has one caller. Files: `dobius/src/main/agents/agent-run-event-journal.ts`, `dobius/src/main/agents/agent-run-events.ts`.
2. (S) Fix the stale plan anchors (B2 at `agent-runner.ts:306,356,482`; B3 replay cap not found). Files: `plans/DOBIUS-AGENTIC-BUILD-PLAN.md`.
3. (M) Add ledger transition events (Asana claim and dispatch, cloud job state). Each calls the one writer from task 1. Files: `dobius/src/main/agents/asana-dispatch-ledger.ts`, `dobius/src/main/automations/cloud-jobs/store.ts`, `dobius/src/main/automations/cloud-jobs/cloud-worker-attempt-lifecycle.ts`.
4. (M) Fill `AgentRunContext` at the 11 `startAgentRun` callers (see section 5 for the list). Start with `agents/asana-auto-mode-service.ts`, `agents/agent-heartbeat-service.ts`, `voice-conductor/conductor.ts`. Files: the 11 files named in section 5.
5. (S) Add the managed-run check and the `unmanaged` mode in `dobius/src/main/agents/agent-runner.ts` (near `:315`), with a type change in `dobius/src/shared/agents.ts:113`. Turn on only after task 4 is merged.
6. (S) Add tests: a managed run with no context is refused; an `agents-page` run with `unmanaged` still starts; each of the 11 callers passes context. Files: `dobius/src/main/agents/agent-runner-session-lease.test.ts` (pattern), plus a new `dobius/src/main/agents/agent-runner-context-gate.test.ts`.
7. (L) Move ledger state into the event log, so the event log is the only source of truth (plan B3 full scope). Only after 1-6 are stable.

Known baseline test failures to ignore (from the brief): 164 in `src/main/ipc/pty.test.ts`, and 16 in renderer terminal-pane tests.

## Open questions for Carson

1. Should a run with no task be refused, or allowed only as an explicit "unmanaged" run? (Recommend: refused by default, and only the Agents page can start unmanaged.)
2. Heartbeat runs (`agent-heartbeat-service.ts:180`) and channel runs have no task. Do they become "unmanaged", or do they get a standing task like "Adam heartbeat"?
3. Should Asana and cloud job state move into the event log now (task 7, large), or after the feed ships?
4. The plan says the live database holds 21,135 events against 33 evidence rows. Is that the journal file, or a different store? Someone with the live database should confirm before we design around it.
5. Where should the audit file `plans/research/IRIS-PLAN-AUDIT-20261121.md` be? It is not in this checkout, so the plan's audit rules cannot be applied.

## Confidence

- Verified (read in source or grep counts): the four record books and their files; the single journal writer; the gate's pause-only logic and its callers; the 11 unset contexts; the `agent-runner.ts` choke point and its current line numbers.
- Inferred (not run): the ledger-to-journal change is safe for the Asana claim logic (needs a test); the cloud job SQLite tables may hold state the journal should not duplicate.
- Not verified: the live database counts, the orphan-row bug, the replay cap.
