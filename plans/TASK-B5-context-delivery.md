# TASK B5 — Deliver ADAM's admitted context to the admitted run

Branch `feat/b5-context-delivery`, stacked on B2 (`20b49392..4c511e1d`).

## What

B2 made every non-manual agent run pass ADAM's admission gate and carry the
approved context pack (`projectId`, `digest`) on the run record and its events.
Nothing reaches the spawned agent itself yet. B5 delivers it through three
additive surfaces, only for admitted (non-`agents-page`) runs:

1. Env vars on the spawned process: `DOBIUS_PROJECT_ID`, `DOBIUS_CONTEXT_DIGEST`,
   `DOBIUS_WORKTREE_ID` (when the run context has a worktree). Merged over the
   existing run env, never replacing it.
2. `.dobius/context/current.json` in the run's cwd, written atomically at admit
   time: `{ projectId, contextDigest, worktree, origin, admittedAt }`. `.dobius/`
   is appended to the cwd's `.gitignore` when the cwd is a git checkout root
   (`.git` present) and the pattern is missing. A write failure is logged and
   the run continues.
3. One banner line in the agent's system prompt:
   `Dobius context: project=<id> digest=<short>`. Claude: appended to the
   existing `systemPrompt` option (preset + append when the agent has no prompt
   of its own, so the default Claude Code prompt is kept). Codex: appended
   to the same system-prompt prefix `codexPrompt` already builds.

## Why

The run was admitted *into* a project with a pinned context digest; the agent
should be able to say which one (for ADAM event correlation, for tools reading
`DOBIUS_PROJECT_ID`, and for a human reading the transcript).

## Files

- new `dobius/src/main/agents/agent-run-context-delivery.ts` (+ test)
- `dobius/src/main/agents/agent-runner.ts` (wire the three surfaces)
- `dobius/src/main/agents/codex-agent-execution.ts` (accept `env` + `contextBanner`)
- `dobius/src/main/agents/agent-runner-adam-admission.test.ts` (runner-level proof)

## Test

From `dobius/`:
`npx vitest run --config config/vitest.config.ts src/main/agents/agent-run-context-delivery.test.ts src/main/agents/agent-runner-adam-admission.test.ts`
New tests fail on the B2 tip, pass with this change. `pnpm run typecheck` exit 0.

## Risks

- Writing into the user's repo cwd: mitigated by gitignore handling, atomic
  write, and log-and-continue on failure.
- A system-prompt change for Claude runs: only when admitted; empty-prompt agents
  get preset+append rather than a replacing one-line prompt.

## Out of scope

Full vault context pack (Graphy freshness, capability sections, MCP resource,
task truth), ADAM-side changes, manual Agents-page runs.
