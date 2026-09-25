# REPAIR BUILD-011 — Agent identity save safety (#40 #41)

## Root cause
- **#40** `AgentsPage.saveAgent()` wrote all six identity files (`soul role playbook rules brief
  memory`) from `agentFiles`, a snapshot read when the agent was selected. An agent run appends
  to `memory.md` while the form is open, so saving a tagline/persona edit wrote the stale snapshot
  over the agent's new memory. `writeAgentFile()` had no revision check, and `atomicWrite()` used a
  pid-only tmp name (`<file>.<pid>.tmp`, `agent-identity-files.ts:63`), so two writers in one
  process could share it. The memory panel's "Save memory" (`use-agent-detail-actions.ts`) had the
  same stale-overwrite path.
- **#41** One effect keyed on `[selectedAgent, selectedAgentId]` reset the draft AND the transcript.
  `saveTagline()` → `setAgents()` replaces the selected agent object, so a tagline edit during a
  streaming run wiped the live transcript.

## Fix
- Main (`agent-identity-files.ts`): `writeAgentFile(agentId, name, content, expected?)`. When
  `expected` (the copy the editor loaded) is given: on-disk == new content → no-op success
  (idempotent retry); on-disk differs from `expected` → throw a conflict error (marker
  `AGENT_FILE_CONFLICT`, `src/shared/agent-file-conflict.ts`), nothing written; missing file →
  write. `atomicWrite` now uses BUILD-009 `writeFileAtomic` (unique tmp, tmp removed on failure).
  `parseExpectedAgentFile()` validates the IPC value: non-string → throw (fail closed).
- IPC/preload: `agents:writeFile` takes an optional 4th arg `expected`.
- Renderer: new `use-agent-identity-files.ts` owns `agentFiles` plus a per-agent baseline (the
  loaded copy). Save writes only files that differ from the baseline, each guarded by its baseline
  copy; untouched `memory.md` is never submitted. A save for an existing agent whose files have
  not loaded (or belong to another agent) is refused. After partial success the baseline advances
  for written files; on full success the files are re-read so agent-written content shows.
  Conflict → toast "A file changed on disk while you were editing … It was not overwritten." with
  a "Load latest" action (re-reads from disk). Brand-new agents (random UUID dir) write all files
  unguarded, as before. Stale `readFiles` responses for a previously selected agent are dropped.
- Memory panel save uses the same guarded path (`names: ['memory']`).
- #41: new `use-selected-agent-sync.ts` — draft still resyncs on every agent object change, but
  the transcript is cleared only when the selected agent **id** changes.
- `AgentsPage.tsx` shrank 442 → 421 physical lines; its pre-existing max-lines error (418 counted)
  is now gone (under 400 counted).

## Tests
- `src/main/agents/agent-identity-files.test.ts` (real fs in a tmp HOME): agent appends to memory
  after load → save with loaded copy throws conflict, appended bytes intact; matching copy
  writes; retry with content already on disk succeeds; no tmp files left; IPC parser rejects
  non-string.
- `src/renderer/src/components/agents/use-agent-identity-files.test.ts`: persona-only edit writes
  only `soul` (memory not submitted), memory edit guarded by loaded copy, partial conflict
  reporting, new agent writes all six.
- `use-agent-identity-files.hook.test.tsx` (happy-dom): save before load refused with no write;
  persona edit writes one file with expected; retry after conflict does not rewrite saved files.
- `use-selected-agent-sync.test.tsx` (happy-dom): tagline object replacement keeps transcript,
  new events append once; switching agent clears it.
- Mutation checks (each made a test fail, then restored): M1 drop main conflict check; M2 IPC
  parser accepts non-string; M3 renderer writes all files; M4 renderer omits expected; M5
  transcript effect keyed on the agent object; M5b transcript reset unconditionally; M6 remove
  "not loaded" guard; M7 baseline not advanced after partial save.

## Deviations from EXECUTION-ORDER.md
- Files outside the spec list (minimal): `src/main/ipc/agents.ts`, `src/preload/index.ts`,
  `src/preload/api-types.ts` (carry `expected`), `use-agent-detail-actions.ts` (memory panel save
  had the same stale overwrite), new `src/shared/agent-file-conflict.ts`, and two new hooks.
- Check is content-based, not mtime: identity files are small, and mtime has coarse granularity.
  A write racing between the check and the rename in main is still possible (no cross-process
  lock with the agent CLI); the window is one synchronous read + rename.
- `AgentBriefingCard` "tune brief" still writes `brief.md` without `expected` (unchanged; the
  brief is not agent-written).

## Rollback
Revert the commit. No data format change; the optional IPC argument is ignored by old code.

## Verification
- `pnpm run typecheck` exit 0.
- Targeted vitest: 5 files / 19 tests green (agent-identity-files + components/agents/).
  `register-core-handlers.test.ts` fails identically to baseline (listed in basefail.txt;
  `ipcMain` undefined in `vertex-tasks.ts`, unrelated).
- oxlint + react-doctor clean on every changed/new file.
- Full suite: DEFERRED (coordinator).

## Lessons
- react-doctor flags `setState` in an effect keyed on a prop when the effect body is a single
  set call (no-derived-state-effect / no-adjust-state-on-prop-change); folding the reset into
  the async loader or a guarded branch keeps the intent and passes.
