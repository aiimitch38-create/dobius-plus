# REPAIR BUILD-022 — Codex provider parity (#5 #55 #67 #70, + Codex review F3)

## Root cause
The Codex branch of `startAgentRun` (`agent-runner.ts`, `if (agent.engine === 'codex')`) returned
before any of the run policy the Claude branch applies: no maxTurns/maxBudgetUsd, no capability
profile (`resolveAgentRunProfile` / `builtInToolsFor`), no `canUseTool`, no hard-rail PreToolUse
hook, and none of `outputFormat` / `onResult`. `codex exec` (checked: `codex exec --help`,
codex-cli 0.147.0) has no turn, budget or per-tool option, so none of that can be passed through.
- #5: Codex runs had no turn/tool/budget limit at all.
- F3 (extra scope): restricted profiles (heartbeat, channel, asana, imessage, voice-conductor) ran
  on Codex with full `workspace-write` / `danger-full-access` sandbox and no rails.
- #55: `finishCodexRun` never calls `onResult`, so a successful Codex triage never ran
  `handleResult` and its gid stayed in `inFlightTriageGids`.
- #67: a heartbeat on a Codex agent dropped `model: claude-haiku-4-5`, the verdict schema and
  `onResult`, so no verdict was ever routed.
- #70: `spawn('codex')` used a bare name (GUI PATH is minimal → ENOENT), and `child.stdin` had no
  `'error'` listener, so ENOENT/EPIPE on the prompt write was an uncaught exception in main. A
  failed spawn also emits `'error'` then `'close'`, calling `onFinish` twice (`once('error')` also
  left a second child error unhandled).

## Fix
- New `src/main/agents/codex-run-policy.ts` (agent-runner.ts is already over max-lines):
  - `assertCodexRunSupported(options)` throws `CodexRunUnsupportedError` for: any profile other
    than `manual` (profile ?? source), an explicit `allowedTools`, an explicit `permissionMode`, an
    explicit `maxBudgetUsd` (Codex reports no cost), and `outputFormat`/`onResult` (no structured
    SDK result). Called in `startAgentRun` right after the agent/prompt checks, BEFORE the slot
    reservation, `prepareCodexLaunch`, the run record and the spawn.
  - `codexToolStepFromLine` + `DEFAULT_CODEX_MAX_STEPS = 100` (same as Claude's default maxTurns).
- `codex-agent-execution.ts`:
  - spawns `resolveCodexCommand()` (existing resolver used by rate-limits and accounts);
  - enforces `maxSteps` (= `maxTurns ?? 100`): each distinct tool item (command_execution,
    file_change, mcp_tool_call, web_search) seen on `item.started`/`item.completed` counts once;
    one over the cap → SIGTERM, stop reading output, settle `error` "exceeded its limit of N tool
    steps" on close;
  - `stdin.on('error')` records the error; a code-0 close after a stdin error is `error`
    ("Codex did not receive the prompt"), never success;
  - one `settled` guard so `onFinish` fires exactly once (error-then-close, double close);
  - honors a per-run `model` override (parity; heartbeat itself is refused before it matters).
- `agent-runner.ts`: the policy call and passing `model` / `maxSteps` through (wiring only).
- `agent-heartbeat-service.ts`: tick skips Codex agents (warns once per agent), so a refused
  heartbeat is not retried and logged every minute (`lastHeartbeatAt` only moves on success).

## Decisions (safest option, flip later)
- F3: chose REJECT, not enforce. `--sandbox read-only` would cover a read-only profile's
  filesystem, but not MCP/tool allowlists, dontAsk, or the credential/memory hard rails, and no
  sandbox mode can be proven equivalent in a unit test. Only plain `manual` runs are allowed.
- This includes `channel`: Communications' `CodexCliProvider` launches with `source: 'channel'`,
  so Codex agents (Edith, Watson) can no longer answer in channels; they fail with a clear error.
- #55/#67 resolved by "declare unsupported before dispatch" (matrix option): a Codex triage or
  heartbeat is refused before any slot is taken, so the Asana slot is released exactly once by
  `dispatchTriage`'s catch; no synthetic SDK result (it would have to invent cost/usage).
- USD budgets: explicit ones are rejected; default manual Codex runs are bounded by the step cap.

## Tests
- `codex-agent-execution.test.ts` (extended): resolved command spawned; step cap stops with one
  error; assistant messages not counted; exactly-once on success / error+close / cancel; stdin
  EPIPE (fake) → one error; real child: missing binary (ENOENT) → one error, no uncaught error;
  real `/usr/bin/true` with a 4 MB prompt (EPIPE) → one error. Real-child tests set
  `PATH=/nonexistent/...` so a regression can never reach a real Codex CLI.
- `agent-runner-codex-policy.test.ts` (new): real runner + real policy; each restricted profile
  and each unenforceable option rejected with no spawn, no run record, no slot; 9 rejected
  heartbeats leak no slot (8 runs still fit, 9th refused); maxSteps/model passed through;
  success/error/cancel settle once (notification once, onRunEnded once for error/cancel) and free
  the slot.
- `agent-heartbeat-service.test.ts` (new): Codex agent never dispatched, warned once; Claude
  agent still dispatched.
- `asana-auto-mode-admission.test.ts` (extended): Codex refusal frees each triage slot once.

### Mutation checks (each broke ≥1 test, then restored)
M1 no stdin error listener (2 + unhandled error) · M2 no settled guard (2) · M3 no step cap (1) ·
M4 bare `'codex'` (1) · M5 code-0-after-stdin-error treated as success (2) · M6 policy call
removed from runner (15) · M7 `finishCodexRun` liveness guard removed (3) · M8 maxTurns not
passed as maxSteps (4) · M9 profile check disabled (9) · M10 heartbeat Codex skip removed (1).
Incident: M4 was first run before the PATH guard existed; it spawned the real `codex` CLI once
(prompt "go", model gpt-5-codex, cwd = this worktree, ~16 s). No files changed (`git status`
clean apart from this build). The PATH guard was then added and M4 re-run (1 fail, 1.5 s).

## Verification
`pnpm run typecheck` exit 0. `vitest src/main/agents/` 21 files / 225 tests green; providers,
voice-conductor, rpc, codex-cli dirs green except `communications/providers/agent-provider.test.ts`
(1 test, `electron` mock lacks `app` — listed in basefail.txt, pre-existing). oxlint clean on
changed files except the pre-existing `agent-runner.ts` max-lines (486 → 496 counted lines).

## Deviations from EXECUTION-ORDER.md
- New module `codex-run-policy.ts` and new tests `agent-runner-codex-policy.test.ts`,
  `agent-heartbeat-service.test.ts`; test-only edit to `asana-auto-mode-admission.test.ts`.
- `agent-runner.ts` max-lines left (pre-existing; needs a file split out of scope). +10 lines.
- Budget is not enforced in USD (not possible with `codex exec`); rejected when explicit.

## Rollback
Revert the commit.

## Lessons
- A mutation check that removes a safety guard can make the test itself do the dangerous thing
  (here: spawn a paid CLI). Real-process tests must be sandboxed independently of the code under
  test (PATH pinned to a nonexistent dir).

## Review round 1 (second commit)
- F1 (medium): with a Codex agent set as the Asana triage agent, every task counted a
  refused run as a failed attempt, so the whole queue dead-lettered within 2 ticks.
  - `maybeDispatchTask` now checks the triage agent's engine BEFORE `claimTask`. For Codex it
    claims nothing and posts one `now` brief: "Codex agents can't triage. Pick a Claude agent."
    The brief is deduped per triage agent id. The set clears once a non-Codex agent dispatches.
  - The `dispatchTriage` catch treats `CodexRunUnsupportedError` like `ExecutionBlockedError`:
    it calls `releaseClaim` and logs, and never calls `recordFailure`.
  - Optional AsanaPane annotation skipped (renderer + i18n scope).
- F2 (low): iMessage to a Codex agent replied "busy". There is now a dedicated reply:
  "<name> runs on Codex and can't answer iMessage."
- F3 (low): `collab_tool_call` (multi-agent items) now counts as a tool step, and runs pass
  `--disable multi_agent`. Support was confirmed with `codex.js exec --help` (0.156.1 has
  `--disable <FEATURE>`). The `multi_agent` feature key appears in the strings of both the
  0.156.1 and the homebrew 0.147.0 binaries, which were read as files, not run.
  Unknown flags make codex exit with "Unknown feature flag", so a mismatch fails loudly.
- Tests: asana-auto-mode-admission (refusal releases the claim with no failure recorded; Codex
  triage never claims and briefs once over 3 ticks); agent-channel-service (Codex reply);
  codex-agent-execution (`--disable multi_agent` in the spawn args; collab items hit the cap).
- Mutation checks (each failed 1 test, then restored): engine check removed · catch branch
  removed · brief dedupe removed · iMessage branch removed · collab type renamed ·
  multi_agent flag renamed.
- Incident: while checking feature names, `codex features list` was run once against the
  homebrew CLI. It is a local listing with no exec and no network run. No other codex spawn.
