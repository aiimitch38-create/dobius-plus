# TASK-COMMS-P5 — AgentProvider seam + executable harnesses

## What
Phase 5 of the comms master plan, scoped to this task:
1. `AgentProvider` seam in `src/main/communications/providers/` — launch/send/subscribe/cancel/status. Two behavior-preserving impls (ClaudeAgentSdkProvider, CodexCliProvider) delegating to `startAgentRun`/`stopAgentRun`/`listAgentRuns`. No reimplementation of launching.
2. `CustomHarnessProvider` — spawns stored command/args/env from custom-harness-store. Validation: empty command rejected; null bytes rejected anywhere in command/args/env (repo rule); command must be absolute path or bare PATH-resolvable name (no relative separators). Env is write-only: never returned via status/events/launch results, never logged.
3. Identity binding on launch: every provider calls `ensureAgentIdentity(agentId)` (same pattern as huddle agents / relay-world-ops / native Buzz directory).
4. Catalog wiring: the vendored Buzz "Settings > Harness Catalog" was deleted with the vendor client (Phase 4). Rebuild a minimal catalog section in the renderer (Settings > Agents) wired through the existing `agents:*` IPC family in src/main/ipc/agents.ts (no new channel family; no communications-bridge/command-table edits).

## Why
OpenBot-style any-provider harness; every provider instance appears in Communications under its own Nostr identity. Seam keeps Claude/Codex behavior byte-identical.

## Test
`pnpm run typecheck:node`; `npx vitest run src/main/communications/providers src/main/agents src/preload` (+ touched suites). Existing agent-runner tests stay green (none exist directly; custom-agents RPC suite mocks agent-runner).

## Risks
- Importing agent-runner into provider tests pulls electron/SDK → mock module like custom-agents.test.ts does.
- Identity store writes to ~/.dobius → always mock agent-participant-identity-store in tests.
- Other agents' untracked files may fail typecheck — confirm none are mine.

## Estimate
Large. Files: ~6 new main-process, 2 preload, 1 renderer component, 4 test files.
