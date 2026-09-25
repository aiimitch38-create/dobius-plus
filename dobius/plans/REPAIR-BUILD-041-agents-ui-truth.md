# REPAIR BUILD-041 — Agents UI truth

Bugs: #98, #99, X6. Depends on BUILD-011, BUILD-023 (both merged in `stabilize/integration`).

## Root causes

### #98 — Live panel shows stale summaries as current
`R/components/agents/AgentLivePulse.tsx` `crewRowText()` returned `run.summary || run.status`
for the agent's latest *finished* run. The row state was already `idle` (no equalizer), but the
prose itself carried no time context, so a summary from days ago read like live activity under
the "Live" heading.

Fix: finished runs render as `Last run <age> · <summary|status>`, age taken from `endedAt`
(falls back to `startedAt` for runs without an end stamp). Running runs are unchanged.
The age formatter lives in a new pure helper `agents/agent-run-age.ts` (`formatRunAge`).

### #99 — Crew "running" counts runs, not agents
`R/components/agents-hub/AgentsOverview.tsx` computed
`running = runs.filter(status === 'running').length` and rendered
`${agents.length} agents · ${running} running`. One agent can have several running runs (one per
channel session key), so the number labeled next to "agents" was run cardinality.

Fix: new pure helper `agents-hub/crew-running-counts.ts`:
- `crewRunningCounts(agents, runs)` → `{ activeAgents, runningRuns }`; `activeAgents` counts
  configured agents with at least one running run (same rule the per-agent rows use for
  "· running"), `runningRuns` counts running runs.
- `crewSubtitle()` renders `N agents · A running`, and appends `· R run(s) active` only when the
  two counts differ. Two runs for one agent → `… · 1 running · 2 runs active`.

### X6 — Command Center "Generate" not wired to a pipeline
`R/components/command-center/StudioCanvas.tsx` dock button "Generate" only called
`onAdd('brief')`, i.e. it created a brief panel whose own body already says "Execution
connector not wired". No generation backend exists (grep of `command-center/` for
generat/brief: only brief UI and the inspector's "Provider execution ... not connected" note).

Fix (per brief: do not build the feature): the dock button is `disabled`, with visible text
"Not available yet" (and `title`). Adding a brief is still available from the sidebar
"Create → Generation brief" row and the "Create generation brief" command in `StudioShell.tsx`,
so no capability is lost. StudioCanvas does not use i18n, so no locale files changed.

## Files
- `dobius/src/renderer/src/components/agents/AgentLivePulse.tsx`
- `dobius/src/renderer/src/components/agents/agent-run-age.ts` (new)
- `dobius/src/renderer/src/components/agents-hub/AgentsOverview.tsx`
- `dobius/src/renderer/src/components/agents-hub/crew-running-counts.ts` (new)
- `dobius/src/renderer/src/components/command-center/StudioCanvas.tsx`

## Tests
- `agents/AgentLivePulse.test.tsx` (new): finished run shows `Last run 3d ago · <summary>`;
  no end/summary falls back to start time + status; running run shows summary as-is.
- `agents/agent-run-age.test.ts` (new): formatter buckets, future timestamps clamp to "just now".
- `agents-hub/crew-running-counts.test.ts` (new): 1 agent / 2 runs; finished runs ignored;
  running run of a deleted agent is not an active agent; empty crew.
- `agents-hub/AgentsOverview.test.tsx` (extended): rendered subtitle for two running runs of one
  agent is `1 agents · 1 running · 2 runs active`, never `1 agents · 2 running`.
- `command-center/StudioCanvas.test.tsx` (new): Generate is disabled, says "Not available yet",
  click does not call `onAdd`.

Targeted run (`agents`, `agents-hub`, `command-center` dirs): 14 files, 50 tests passed.

### Mutation checks (each seen FAIL, then restored and PASS)
1. `AgentLivePulse.tsx` return reverted to `run.summary || run.status` → AgentLivePulse.test 2 failed.
2. `AgentsOverview.tsx` subtitle reverted to the old run-count template → AgentsOverview.test 1 failed.
3. `crew-running-counts.ts` `activeAgents: running.length` → crew-running-counts.test 2 failed.
4. `StudioCanvas.tsx` Generate restored to `onClick={() => props.onAdd('brief')}` (not disabled) → StudioCanvas.test failed.

## Verification
- `pnpm run typecheck`: exit 0.
- `npx oxlint` and `npx oxlint --config config/oxlint-react-doctor.json` on all 10 changed files: clean.
- Full suite: deferred to coordinator.

## Deviations
- X6 file determined: `R/components/command-center/StudioCanvas.tsx` (spec said UNDETERMINED).
- Pre-existing "1 agents" pluralization left as is (not in scope).

## Rollback
Revert the commit. No data, IPC or storage changes.

## Lessons
- The Live panel already separated idle vs working by state; the truth gap was the text. Age
  labels belong in the text itself because the row truncates and there is no timestamp column.
