# REPAIR BUILD-007 — run capability profiles (#7 #6 #73 N3)

## Root cause
Authority was granted by tool availability, never per run:
- #7: `withDobiusToolAllowRule` appended `mcp__dobius__*` to every Claude run and
  `buildDobiusToolServer` always registered `dispatch_build` (plus 5 crew tools), so any
  manual, heartbeat, channel, iMessage or triage run could launch a build.
- #6: `dispatchBuild` (`dobius-tool-handlers.ts`) had no capability, lane or capacity check.
  It creates a managed worktree + YOLO terminal agent outside `startAgentRun`'s cap, so a
  review-lane triage or a prompt-injected channel run could start builds, and concurrent or
  repeated calls could oversubscribe.
- #73: `tools: args.options?.allowedTools` passed the permission allowlist as the SDK's
  built-in *availability* list — MCP globs (`mcp__dobius__*`) and permission rules
  (`Bash(git:*)`) became `--tools` names. Triage got `--tools mcp__dobius__*`.
- N3: the Voice Conductor records runs as `source: 'channel'`, so it inherited
  `CHANNEL_AGENT_BASELINE_TOOLS` (Task, NotebookEdit, TodoWrite, `mcp__playwright__*`), the
  channel chat tools and `dispatch_build`, and its `tools` stayed the SDK default set.

## Fix
- `agent-runner-dobius-tools.ts`: a run profile table (`resolveAgentRunProfile`). Profile id
  defaults to `source`; the conductor passes `profile: 'voice-conductor'`.
  | profile | dobius tools |
  |---|---|
  | manual, heartbeat | asana_draft_comment, read_knowledge, list_crew, crew_status, file_briefing_item |
  | channel | post_channel_message, post_channel_screenshot, create_board_task + the 5 above |
  | asana (triage) | file_briefing_item, asana_draft_comment, read_knowledge; **+ dispatch_build only when the trusted lane is `build`** |
  | voice-conductor | none (it uses its dobius-* CLI commands); no dobius server attached |
  Channel baseline union happens only for the `channel` profile.
- `buildProfileAllowedTools`: strips every caller/agent `mcp__dobius__…` entry (including the
  wildcard) and appends the profile's explicit `mcp__dobius__<name>` entries.
- `builtInToolsFor` (#73): SDK `tools` = built-in names from the caller's explicit list only
  (MCP entries dropped, `Name(rule)` → `Name`); explicit `[]` → `[]` (no built-ins);
  omitted → `undefined` (SDK default, unchanged for manual/heartbeat/RPC runs).
- `dobius-tool-server.ts`: registers only `context.tools`.
- `dobius-tool-handlers.ts` `dispatchBuild`, defence in depth for direct calls:
  1. capability: `context.tools` must include `dispatch_build`;
  2. lane: `context.buildLane === 'build'` (set by the runner from the Asana service's routing,
     never from model input);
  3. existing arg validation and the BUILD-001 `checkExecutionAdmission('dispatch-build')` call,
     unchanged and in the same place;
  4. capacity, reserved synchronously right before the only `await`: at most 1 dispatch in
     flight app-wide and 1 successful build per run. Released on throw and on `ok:false`
     (run allowance returned so the model can retry); in-flight slot released on success.
     Blocked/denied paths return before reserving.
- `asana-auto-mode-service.ts`: passes `asanaLane: lane` and `allowedTools: []`.
- `conductor.ts`: passes `profile: 'voice-conductor'` and `allowedTools: CONDUCTOR_ALLOWED_TOOLS`.

## Tests
- `agent-tools/dobius-tool-server.test.ts`: table — manual/heartbeat/channel/asana build/asana
  review/asana no-lane/voice-conductor/non-asana claiming build lane → exact profile set AND
  exact registered server tools; dispatch denied (before admission and dispatcher) for
  channel, manual, build-lane-without-capability, review lane with tool, no lane; concurrent
  dispatch refused while one is in flight, released on success; one build per run; release
  after dispatcher throw and `ok:false`; admission block consumes no capacity. Existing
  handler tests now run under a build-lane triage context.
- `agents/agent-runner-tool-profiles.test.ts` (new): real runner + real profile module, SDK
  `query` captured — manual (wildcard in agent allowlist stripped, `tools` undefined),
  heartbeat, build/review triage (`tools: []`), legacy `['mcp__dobius__*']` → `tools: []`,
  channel `['Read','Bash(git status:*)','mcp__playwright__*']` → `tools: ['Read','Bash']`,
  conductor → exactly its 8 tools, `mcpServers: {}`.
- `voice-conductor/conductor.test.ts`: a transcript run passes `profile: 'voice-conductor'` and
  the conductor's own allowlist.
- `agent-runner-admission.test.ts`: mock updated for the new exports only.

### Mutation checks (each broke ≥1 test, then restored)
M1 remove capability check (survived at first — lane check masked it; added the
"build lane without capability" case, then 1 fail) · M2 remove lane check (2) · M3 remove
in-flight cap (1) · M4 no release on dispatcher throw (2) · M5 remove per-run cap (1) ·
M6 server registers every tool (8) · M7 `tools: args.options?.allowedTools` restored (1) ·
M8 wildcard kept in allowlist (4) · M9 conductor inherits channel baseline (1) ·
M10 dispatch_build for any asana lane (4) · M11 conductor drops its profile (1).

## Deviations from EXECUTION-ORDER.md
- Spec lists `conductor.ts:22-30,101`; the fix is in the conductor's `startAgentRun` call
  (a `profile` option) rather than the agent definition, because the run source must stay
  `channel` (budget, settingSources, run records) while the tool set must not.
- Added `asana-auto-mode-service.ts` (outside the file list): the trusted lane must come from
  the caller that routes by Asana assignee; it also drops the `['mcp__dobius__*']` allowlist.
- New test file `agent-runner-tool-profiles.test.ts` for the query-argument fixture (the
  spec names only `dobius-tool-server.test.ts`; runner mocking does not fit there).
- Budget for the dispatched terminal agent is NOT added: the terminal agent is launched by
  `createManagedWorktree` with YOLO args outside `startAgentRun`; that launch policy is the
  ADAM/terminal-agent build (EXECUTION-ORDER BUILD for `execution-gate.ts` ADAM check).

- Lint: `max-lines` errors are pre-existing in `agent-runner.ts` (459 → 464 lines) and
  `dobius-tool-handlers.ts` (309 → 352). Fixing them needs a file split, left per the rules.
  Everything else oxlint + react-doctor clean.

## Verification
- `pnpm run typecheck` exit 0.
- `src/main/agents` + `src/main/voice-conductor`: 22 files / 143 tests green.
- Full suite: DEFERRED (coordinator).

## Decisions for Carson
- Manual and heartbeat runs keep the crew tools but lose `dispatch_build`.
- Build capacity: 1 dispatch in flight app-wide, 1 build per triage run.
- Triage gets `read_knowledge` in addition to the three tools its prompt names.

## Rollback
Revert the commit: profiles removed, `mcp__dobius__*` wildcard grant returns. No data format
changes.

## Lessons
- A mutation that removes one guard can be masked by a neighbouring guard; each guard needs a
  case where only it stands between the caller and the action.
- A never-resolving mock implementation (`vi.fn(() => new Promise(...))`) hangs every later
  call too; use `mockImplementationOnce` for the pending one.
