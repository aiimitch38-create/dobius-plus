# REPAIR BUILD-001: fail-closed "Pause crew" execution gate

Full spec: `docs/stabilization/BUILD-001.md` on branch `stabilize/iris-20260923`.

## Root cause
- `agents-config-store.ts` `load()` turned any read/parse error into `DEFAULT_CONFIG` (`agentsPaused: false`). The next-day rollover then persisted those defaults over the original file (bug #2).
- Only heartbeat and Asana read the pause flag. Kanban auto-dispatch, the Voice Conductor, iMessage `@Agent`/`d:`, `dispatch_build`, RPC/CLI `agent.run`, workflows and providers ignored it (bug #1).

## Fix
- Store: missing file = unpaused (unchanged). Existing but unreadable, malformed or wrongly typed = paused. It is never written while unreadable, is re-read on each call until repaired, and resuming throws.
- New `agents/execution-gate.ts`: one `checkExecutionAdmission(origin)`. Only `'agents-page'` (from `ipc/agents.ts`) is exempt. The default origin is autonomous.
- `startAgentRun` checks before reserving a slot and again after the `prepareClaudeLaunch` await.
- Explicit checks in `dispatch_build`, iMessage `d:` (refused with a reply, not queued), Asana (no claim while blocked; a blocked start releases the claim instead of counting a failure) and the Kanban poll (no claim while paused; IPC error = paused).

## Tests
- New: `agents-config-store.test.ts`, `execution-gate.test.ts`, `agent-runner-admission.test.ts` (mutation-checked: removing the slot release makes it fail), `asana-auto-mode-admission.test.ts`, `imessage-bridge/bridge-service-admission.test.ts`.
- Extended: ledger, tool-server, channel-service and board-dispatch tests.

## Verification (2026-09-24, Node 22.22.3; the repo wants 24)
- `pnpm run typecheck`: exit 0.
- Targeted suites (`src/main/agents`, `src/main/imessage-bridge`, `src/renderer/src/components/kanban`): 17 files, 98 tests pass.
- Full vitest: 85 failing files. Re-run on the untouched parent commit `b5c66cf5`: 84 of them fail there too. The 85th (`hermes/hook-service.test.ts`) passed 3 of 3 runs on both trees. It's flaky under full-suite load and imports nothing this build touched.

## Deviations from the spec
- `max-lines` errors in `agent-runner.ts` (455 lines against a 300 limit, 454 before this build) and `dobius-tool-handlers.ts` (309 lines, 304 before) were already there. Fixing them means splitting files, which is out of scope here, so they're deferred to BUILD-049 (lint debt). The husky pre-commit hook is not installed in this repo (no `core.hooksPath`), so nothing enforces it today.
- `load()` keeps the old cached fast path: a valid config still rolls the ping date over only on first load. Rolling over on every call would have been an unrelated behavior change.

## Rollback
Revert the commit. There is no file-format change, and old code reads `agents-config.json` as written.

## Separate finding (not fixed)
`renderer/.../communications/shared/api/dobiusCommunications.ts` has a duplicate `case` clause that can never run (a vite warning during tests).
