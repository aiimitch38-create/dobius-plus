# REPAIR BUILD-008 — headless permission outcomes (#74 #75 N1 #8 X4)

## Root cause
- **#74 / N1.** `startAgentRun` attached a `canUseTool` only when `source === 'manual'` and the
  mode was `default`. Every other run (heartbeat, Asana, iMessage, workflow, Communications
  providers, Voice Conductor spawns, RPC `agent.run` with a non-manual source) had no
  `canUseTool`. The CLI then refused prompts on its own ("headless-agent auto-deny") or,
  in `dontAsk` mode, before asking. Either way the refusal only reached the model as an
  `is_error` tool result; nothing was recorded on the run, so a run could "succeed" while its
  work was silently blocked.
  The opposite case: RPC `agent.run` with no source (the CLI `dobius agents run`) defaults
  to `source: 'manual'`. That put its prompts in the Agents-page decision queue, where they
  waited with no bound for a person who was not watching.
- **#75.** "Bypass run" calls `query.setPermissionMode('bypassPermissions')`. The runner only
  sets `allowDangerouslySkipPermissions` (the CLI's `--allow-dangerously-skip-permissions`) when
  the run *starts* in bypass mode. Decision-queue runs start in `default` mode, so they never
  have it.
  SDK contract, checked in the installed CLI binary: the CLI rejects the switch with "Cannot set
  permission mode to bypassPermissions because the session was not launched with
  --dangerously-skip-permissions". So the button always threw for every run that could show it.
- **#8 (verify-only).** Not a missing cap. Omitted RPC limits reach the runner defaults
  (`agent-runner.ts`: `maxTurns ?? 100`, `maxBudgetUsd ?? (channel ? 1 : DEFAULT_MAX_BUDGET_USD=2)`).
  Only the comment in `custom-agents.ts` ("startAgentRun has NO default budget") was stale.
- **X4.** The agent edit form said bypass was "unchanged in Phase 1". In fact
  `agent.bypassPermissions` drives `permissionMode` for every run that does not pass its own
  mode.

## Fix
- New `agents/agent-headless-permissions.ts`:
  - `createHeadlessCanUseTool`: answers every prompt at once with a deny. The reason names the
    tool, the run kind ("CLI/RPC" for source-less RPC runs) and the fix: add the tool to the
    allowlist, or run it from the Agents page. It also records the denial.
  - `recordStreamPermissionDenials`: records denials the CLI made itself (`system/permission_denied`
    messages and `result.permission_denials`).
  - `recordPermissionDenial`: saves `{toolName, toolUseId, reason, at}` on the run record. It
    dedupes by `toolUseId` (one denial shows up in canUseTool, the stream and the result), keeps
    at most 20 entries, and broadcasts an `error` run event. It never saves the tool input, so no
    commands or prompt text reach the run file.
  - `withPermissionDenialNote`: appends "Blocked: N tool request(s) needed approval and were
    denied (tools)…" to the final summary. This covers the success, error, abnormal-EOF and
    thrown-stream endings.
- `agent-runner.ts`: `attended = source === 'manual' && origin === 'agents-page'`. Only attended
  default-mode runs get the decision queue. Every non-attended run gets the headless deny.
  `origin` cannot be set over RPC, so an RPC call claiming `source: 'manual'` is still
  headless. Attended runs in bypass mode are unchanged (no canUseTool). Each stream message is
  passed to the recorder.
- `agent-decision-queue.ts`: the context carries `bypassRunSupported` (the runner passes
  `options.allowDangerouslySkipPermissions === true`, which is fixed at launch). Unsupported
  decisions get `bypassRunUnavailableReason`, and `resolveAgentDecision('bypassRun')` refuses
  with that reason *before* the SDK call. The prompt stays pending, so the user can still
  approve or deny it.
- `AgentDecisionTicketDialog.tsx`: the Bypass run button is disabled when a reason is present.
  The tooltip (on a wrapper span, because disabled buttons get no pointer events) shows the
  reason.
- `shared/agents.ts`: `AgentRun.permissionDenials?`, `AgentRunPermissionDenial`, and
  `PendingAgentDecision.bypassRunUnavailableReason?`. `agent-runs-store.ts` `sanitizeRuns`
  keeps well-formed denials across a restart; before this, unknown fields were dropped on load.
- `custom-agents.ts`: the stale #8 comment is corrected, and the `dontAsk` comment now explains
  that every RPC run is headless.
- `AgentEditForm.tsx` (X4): the text now says which runs bypass applies to (Agents page, CLI,
  Voice Conductor). Channel chat, heartbeat, Asana, iMessage and workflow runs pass their own
  `dontAsk`. Hard rails still apply.

## Tests
- `agents/agent-runner-headless-permissions.test.ts` (new). It uses the real runner, the real
  decision queue, the real headless module and the real RPC `agent.run` method. A scripted SDK
  `Query` keeps the stream open until the test finishes it.
  - Heartbeat, Asana, iMessage, workflow and Communications-provider runs: a prompt is denied
    within 50 ms, nothing is queued, the denial is on the run with an error event, and the
    result's repeat is deduped. The summary carries the Blocked note.
  - RPC run with no source, and RPC run claiming `source: 'manual'`: headless, not queued.
  - dontAsk stream denials (`permission_denied` plus `result.permission_denials`) are recorded
    and deduped, and the CLI's message is kept.
  - A run with no denials keeps its summary unchanged.
  - An Agents-page run still queues, is still waiting after 50 ms, and is cleared when the
    run ends.
  - #75 SDK contract: an Agents-page default run launches without
    `allowDangerouslySkipPermissions`. The decision carries the reason, `bypassRun` rejects with
    it, `setPermissionMode` is never called, and the prompt stays pending. A context with bypass
    support calls the handler and approves.
  - #8: RPC with no caps → 100 turns / $2; channel → 100 / $1 plus `dontAsk`; explicit caps pass
    through.
- `renderer/.../AgentDecisionTicketDialog.test.tsx` (new): the button is disabled (click does
  nothing) with a reason, and enabled (click resolves `bypassRun`) without one.
- `agents/agent-runs-store.test.ts` (new): denials survive a save and a reload, and malformed
  entries are dropped.

### Mutation checks
Each mutation was applied, its test file was run, and the file was restored (script:
`stabilize-run/008/mutate.py`). All 11 were killed; the number is how many tests failed.
- M1: no headless canUseTool (7).
- M2: `attended` ignores origin (5).
- M3: no stream recording (1).
- M4: no summary note (7).
- M5: no toolUseId dedupe (6).
- M6: no bypass guard in the queue (2).
- M7: runner claims bypass support (2).
- M8: headless canUseTool allows (7).
- M9: dialog button not disabled (1).
- M10: the store drops denials on load (1).
- M11: the runner's default `maxTurns` is removed (2).

## Deviations from EXECUTION-ORDER.md
- New module `agent-headless-permissions.ts` instead of growing `agent-runner.ts`, which
  already fails `max-lines`. It also keeps the existing runner tests' `agent-decision-queue`
  mocks valid.
- Touched `shared/agents.ts` (new optional fields) and `agent-runs-store.ts` (keeping
  `permissionDenials` on reload), both outside the file list. Without them the outcome is not
  "recorded on the run" beyond the final summary.
- Touched `AgentDecisionTicketDialog.tsx`, the bypass button itself. The spec only named the
  edit form.
- #75 is fixed by disabling, not by negotiating: attended runs are *not* launched with
  `allowDangerouslySkipPermissions` (fail closed). The button is therefore always disabled for
  today's decision-queue runs.
- Not changed: `renderer/.../dobiusCommunications.ts:1824` repeats the same stale "startAgentRun
  has no default" comment. It is a Communications file outside this build's list.

## Verification
- `pnpm run typecheck`: exit 0.
- Targeted vitest: `src/main/agents`, `src/main/voice-conductor`, `src/main/communications/workflows`,
  `rpc/methods/custom-agents.test.ts` and `renderer/src/components/agents`. 37 files / 300 tests
  green.
- Full suite: DEFERRED (coordinator).
- oxlint and react-doctor are clean on every changed file except the pre-existing `max-lines`
  error in `agent-runner.ts`, which grew from 466 to 484 counted lines. Fixing it needs a file
  split, which is out of scope. Most of the new logic went into `agent-headless-permissions.ts`
  to keep that growth small.

## Decisions for Carson
- RPC/CLI `agent.run` without a source is now treated as unattended: its prompts are denied
  and recorded instead of waiting in the Agents panel. Use the Agents page Run button for a
  run you want to approve step by step.
- "Bypass run" is disabled with an explanation. To make it work, Agents-page runs would have
  to launch with `allowDangerouslySkipPermissions: true`. That makes bypass *available* at the
  CLI level, not active; hard rails still apply. It is a one-line change in `agent-runner.ts`.
- Headless denials do not stop the run (`interrupt` is not set): the model gets the reason and
  may finish other work. The run's summary then lists what was blocked.

## Rollback
Revert the commit. The new optional `permissionDenials` field is ignored by old code, which
already drops unknown fields on load.

## Lessons
- The SDK always talks to the CLI over stream-json, so `setPermissionMode` reaches the CLI even
  for string prompts. The real limit is the launch flag, and the rejection text is in the CLI
  binary.
- A "headless" check keyed on `source` alone is not enough: an RPC caller can send
  `source: 'manual'`. Only `origin`, which is set by the IPC handler and not by the caller, can
  tell a watched run from an unwatched one.

## Review follow-up (F1, F2)
- **F1 — Blocked note leaked into Communications chat.** For `source: 'channel'` runs the
  summary is the reply `awaitDobiusAgentRun` (dobiusCommunications.ts) posts into the channel
  and feeds to other agents. `withPermissionDenialNote` now returns the summary unchanged for
  channel runs (it reads the stored run's `source`). Denials stay on `permissionDenials` and
  the error events still fire. Other headless sources keep the note.
  - Test: `channel run: the Blocked note stays out of the chat reply, denials stay on the run`;
    the `it.each` channel rows (iMessage, workflow, Communications provider) now expect the
    summary to be exactly `done`.
  - Mutation: guard disabled → 4 tests fail (`expected 'done\n\nBlocked: …' to be 'done'`).
- **F2 — duplicates and wrong count past the 20-entry cap.** Dedupe used the saved list, which
  stops growing at 20, so every later denial broadcast twice (canUseTool + result list) and the
  note said 20. `agent-headless-permissions.ts` now keeps a per-run in-memory tally (seen
  toolUseIds, true total, tool names) separate from the capped saved list. A seen id returns
  before storing or broadcasting. The note reports the tally total. `consumeRun`'s `finally`
  calls `forgetPermissionDenials(runId)` so the tally does not outlive the run (cancel path
  included).
  - Test: `past the saved cap: each denial broadcasts once and the note counts every one`
    (200 denials via canUseTool, repeated in result.permission_denials).
  - Mutation: old list-based dedupe → `expected [ Array(380) ] to have a length of 200`;
    count from the saved list → `expected 'done\n\nBlocked: 20 tool request(s)…' to contain
    'Blocked: 200 tool request(s)…'`.
- Verification: `pnpm run typecheck` exit 0; `vitest src/main/agents
  src/renderer/src/components/agents` 22 files / 210 tests passed. oxlint: only the
  pre-existing `max-lines` error on `agent-runner.ts` (484 → 486 lines; 2 added lines for the
  cleanup call; a split is out of scope). `sanitizeRuns`/`sanitizePermissionDenials` untouched.
