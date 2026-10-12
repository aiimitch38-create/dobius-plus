# BUILD-001 — Global execution gate, fail-closed pause

- **Bugs:** #1 ("Pause crew" doesn't stop Kanban auto-dispatch or the Voice Conductor), #2 (pause file unreadable → agents turn back on).
- **Layer:** Dobius+ layer only. No engine file is edited (`M/automations/`, `M/runtime/orchestration/` are BUILD-002).
- **Branch:** `stabilize/001-global-execution-gate` from `stabilize/iris-20260923`, worktree `.claude/worktrees/001-global-execution-gate`.
- **Depends on:** Phase 0 baseline (`BASELINE.md`) captured.
- **Size:** 2 bugs, 1 new module, 10 edited files, 1 concern (admission).

Paths: `dobius/src/main/…` = `M/`, `dobius/src/renderer/src/…` = `R/`. Every line number below was re-read on 2026-09-24 in the main checkout (HEAD `7196dd82`). Re-confirm each anchor with `sed -n` before editing; if an anchor moved, find it by the quoted code, not the number.

---

## 1. What is wrong today (verified)

1. `M/agents/agents-config-store.ts:63-73` — `load()` catches every error. A malformed file (JSON `SyntaxError` has no `code`, so it is not even logged) or `EACCES` yields `DEFAULT_CONFIG` with `agentsPaused: false`. Result: an unreadable pause file **unpauses** the crew.
2. Same file `:92-100` — `rolloverPingDate` then **persists** those defaults on the first call of a new day, overwriting the unreadable original with `agentsPaused: false`. The evidence is destroyed.
3. Only two producers read the flag: `M/agents/asana-auto-mode-service.ts:209` and `M/agents/agent-heartbeat-service.ts:196` (`rg getAgentsPaused` on 09-24). Every other start path ignores it.
4. All Claude SDK runs go through one function: `startAgentRun` (`M/agents/agent-runner.ts:257`). `query(` is called nowhere else in `M/` (09-24 search: `@anthropic-ai/claude-agent-sdk` is imported for types elsewhere, `query` only in `agent-runner.ts:412`). Callers: `M/ipc/agents.ts:133` (Agents page), `M/runtime/rpc/methods/custom-agents.ts:148` (RPC `agent.run`: renderer Kanban + Communications chat via `runtime:call`, CLI via unix socket), `M/agents/asana-auto-mode-service.ts:131`, `M/agents/agent-channel-service.ts:131` (iMessage `@Agent`), `M/agents/agent-heartbeat-service.ts:177`, `M/voice-conductor/conductor.ts:135`, `M/voice-conductor/agent-spawn.ts:71`, `M/communications/workflows/workflow-executor.ts:60`, `M/communications/providers/*`.
5. Paths that start work **without** `startAgentRun`:
   - `mcp__dobius__dispatch_build` → `M/agents/agent-tools/dobius-tool-handlers.ts:178-220` → build dispatcher (`M/ipc/register-core-handlers.ts:124-143`) → `runtime.createManagedWorktree({ startupAgent … })`: a terminal agent with skip-permission flags.
   - iMessage `d:` command → `M/imessage-bridge/bridge-service.ts:252-262`: types into the active terminal and presses Enter.
   - Kanban auto-dispatch (`R/components/kanban/board-dispatch.ts:107-122`) claims the card (`status: 'in-progress'`, attempts+1) **before** calling `agent.run`. If the run is refused, the card is marked `failed`/`dead` (`:143-152`), burning an attempt.
   - Automations scheduler and `orchestration.run`: engine files → BUILD-002 (N13).

## 2. Design

One function, `checkExecutionAdmission(origin)`, in a new Dobius module. It reads the crew control state and answers allow / deny. Every autonomous start path calls it, directly or through `startAgentRun`.

- **Fail closed.** Unreadable, malformed, or wrongly typed control state = blocked. An exception while reading = blocked.
- **Default is autonomous.** A caller that passes no origin is treated as autonomous. The only exempt origin is `'agents-page'` (a human clicked Run on the Agents page), passed from exactly one place: `M/ipc/agents.ts`. So a new caller cannot bypass the pause by forgetting a flag.
- **Admission, not cancellation.** Pausing stops new starts. It does not stop runs already in flight (Decision for Carson in the return report).
- **Re-check after the await.** `startAgentRun` checks at entry and again right after `await args.prepareClaudeLaunch(...)` (`agent-runner.ts:324-326`), the only await before `query()`, so a pause during auth preparation still blocks.
- **Missing file stays unpaused.** `ENOENT` keeps today's first-use behavior (`agentsPaused: false`). Only a file that exists but cannot be trusted fails closed. Carson's current file exists and is paused (baseline), so nothing changes on his machine.

**ADAM context handshake (X12): later, not now.** The gate does not call ADAM in this build. Reasons: (1) ADAM being offline would then block every run, including manual ones, before event delivery (#78–#80) and the connection registry (#81, #118) are fixed; (2) ADAM's handshake admits a worktree path (`/Users/bayou/dobius/projects/ADAM/service/src/projects/handshake.ts:110-150`), and Dobius SDK runs (Kanban, chat, heartbeat) have no ADAM project mapping yet; (3) the installed build predates the journal, so ADAM has never seen Dobius runs. BUILD-031 adds the ADAM check inside this same function, first for `dispatch-build` (terminal-agent launches in new worktrees), after BUILD-029/030.

## 3. Changes, file by file

### 3.1 `M/agents/agents-config-store.ts` (fixes #2)

Add:
```ts
export type AgentsControlStatus = 'ok' | 'missing' | 'unreadable'
export type AgentsControlState = {
  paused: boolean            // effective: always true when status is 'unreadable'
  status: AgentsControlStatus
  detail: string | null      // errno code or parse message; never file contents
  filePath: string
}
```
Module state: keep `cached`; add `let loadStatus: AgentsControlStatus = 'ok'`, `let loadDetail: string | null = null`, `let lastLoggedDetail: string | null = null`.

Rewrite `load()` (`:59-75`):
- If `cached` and `loadStatus !== 'unreadable'` → return `rolloverPingDate(cached)` as today.
- If `loadStatus === 'unreadable'`, **re-read** on every call. Why: the file is tiny, and this lets Carson repair it without restarting the app.
- Read with `readFileSync`:
  - `ENOENT` → `loadStatus = 'missing'`, `cached = { ...DEFAULT_CONFIG }`.
  - any other read error → unreadable, `detail = error.code ?? error.message`.
  - `JSON.parse` throws → unreadable, `detail = 'invalid JSON'`.
  - parsed value is not a plain object, or `typeof agentsPaused !== 'boolean'` → unreadable, `detail = 'agentsPaused missing or not a boolean'`.
  - otherwise `loadStatus = 'ok'`, `cached = sanitize(parsed)`.
- Unreadable → `cached = { ...DEFAULT_CONFIG, agentsPaused: true }`. Log with `console.error` once per distinct `detail` (not every call).

Make `persist()` (`:77-90`) return `boolean` (true on success). Keep the warn.

Never write while unreadable:
- `rolloverPingDate` (`:92-101`): update `cached` in memory; call `persist` only when `loadStatus !== 'unreadable'`.
- `setAgentsPaused(paused)` (`:107-112`):
  - unreadable and `paused === true` → return `true`, no write (already effectively paused; keep the evidence).
  - unreadable and `paused === false` → `throw new Error(\`Crew control file could not be read (${filePath()}: ${detail}). Fix or remove it, then resume.\`)`. The renderer already catches this and toasts (`R/components/agents/AgentsPage.tsx:300-306`).
  - otherwise as today; if `persist` returns false while pausing, keep `cached.agentsPaused = true` for this session and `console.error` that the pause is session-only.
- `consumePingBudget` (`:119-128`): unreadable → return `false`, no write.

Add `export function getAgentsControlState(): AgentsControlState` (calls `load()`).
Change `getAgentsPaused()` (`:103-105`) to return `getAgentsControlState().paused` (the effective value). Heartbeat `:196` and Asana `:209` then also stop on an unreadable file with no edit.

### 3.2 New `M/agents/execution-gate.ts`

```ts
import { getAgentsControlState } from './agents-config-store'

// 'agents-page' is the only operator origin; everything else is autonomous.
export type ExecutionOrigin = 'agents-page' | 'agent-run' | 'dispatch-build' | 'imessage-command'

export type ExecutionAdmission =
  | { allowed: true }
  | { allowed: false; reason: 'paused' | 'control-state-unreadable'; message: string }

export function checkExecutionAdmission(origin: ExecutionOrigin): ExecutionAdmission
export class ExecutionBlockedError extends Error { /* name = 'ExecutionBlockedError'; readonly origin; readonly reason */ }
export function assertExecutionAdmitted(origin: ExecutionOrigin): void   // throws ExecutionBlockedError
export function isExecutionBlockedError(error: unknown): error is ExecutionBlockedError
```
Rules inside `checkExecutionAdmission`:
1. `origin === 'agents-page'` → allowed.
2. `getAgentsControlState()` inside `try`; a throw → `{ allowed: false, reason: 'control-state-unreadable', message }`. (A `catch` that returns a denial is handling, not an empty catch.)
3. `status === 'unreadable'` → denied, `control-state-unreadable`, message names the file path and `detail`.
4. `paused` → denied, `paused`, message `"Crew is paused. Resume it on the Agents page to allow autonomous runs."`.
5. Otherwise allowed.

`isExecutionBlockedError` checks `error instanceof Error && error.name === 'ExecutionBlockedError'`, so modules that load the gate by dynamic import can still recognise it.
Keep the file under ~80 lines. No other abstraction.

### 3.3 `M/agents/agent-runner.ts` (the SDK choke point, fixes #1 for all SDK producers)

- `AgentRunOptions` (`:81-102`): add `origin?: ExecutionOrigin` with a one-line why comment: *"Omitted = autonomous, so a new caller cannot bypass Pause crew by forgetting it."*
- `startAgentRun` (`:264`): first statement, **before** the `reservedRuns` check at `:265`:
  `assertExecutionAdmitted(args.options?.origin ?? 'agent-run')`
  No reservation is taken yet, so nothing needs releasing.
- Right after `const preparation = await args.prepareClaudeLaunch(...)` (`:324-326`), inside the existing `try`:
  `assertExecutionAdmitted(args.options?.origin ?? 'agent-run')`
  The existing `catch` (`:426-435`) releases `reservedRuns`/`releaseAgentRun`. `runAdded` is still false, so no run row is written.
- Codex branch (`:292-322`) has no await before `startCodexRun`, so the entry check covers it.

### 3.4 `M/ipc/agents.ts`

- `:131-134` — pass the operator origin:
  `startAgentRun({ ...args, prepareClaudeLaunch, prepareCodexLaunch, options: { origin: 'agents-page' } })`
  `source` stays undefined, which keeps today's `'manual'` behavior and `canUseTool` (`agent-runner.ts:391-398`).
- `:178-182` — no change. `agents:getPaused` now returns the effective value. `agents:setPaused` may reject when the file is unreadable (see 3.1).

### 3.5 `M/agents/agent-tools/dobius-tool-handlers.ts` (dispatch_build)

In `dispatchBuild` after the brief check (`:187-190`) and before `getRepoLister()` (`:191`):
```ts
const admission = checkExecutionAdmission('dispatch-build')
if (!admission.allowed) {
  return errorResult(`build dispatch blocked: ${admission.message}`)
}
```
Keep the tool contract: return `isError`, never throw (same reason as the comment at `:215-216`).

### 3.6 `M/agents/asana-auto-mode-service.ts` + `M/agents/asana-dispatch-ledger.ts`

Pause can flip while `tick` awaits `refreshAsanaTasks()` (`:224`), after the `:209` check.
- `maybeDispatchTask` (`:159-185`): before `claimTask` (`:175`) add `if (!checkExecutionAdmission('agent-run').allowed) { return }` so no claim is written while blocked.
- `dispatchTriage` catch (`:149-156`): if `isExecutionBlockedError(error)` → `releaseClaim(task.gid)` and log at info level; else keep `handleFailure`. Why: a blocked start is not a failed attempt and must not move the task toward `dead`.
- Ledger: add after `recordFailure` (`:144-157`):
  ```ts
  export function releaseClaim(gid: string): AsanaDispatchRecord | null
  ```
  Only acts on `status === 'claimed'`. `attempts === 0` → remove the record (never launched). `attempts > 0` → set back to `'failed'` (it was a reclaimed failed record, `claimTask:111-118`). Persist once. Any other status → unchanged.
- If the module has no test seam, export `asanaAutoModeInternals = { maybeDispatchTask, dispatchTriage }` for tests only.

### 3.7 `M/agents/agent-channel-service.ts` (iMessage `@Agent`)

`startAgentRun` already blocks the run. Fix the reply so the phone does not say "busy":
- Add `import('./execution-gate')` to the `Promise.all` at `:107-110` (this file uses dynamic imports on purpose).
- In the catch at `:156-158`: `isExecutionBlockedError(error)` → reply `"<Agent>: Dobius+ crew is paused, so the run was not started."`; otherwise keep the "busy" text.

### 3.8 `M/imessage-bridge/bridge-service.ts` (iMessage `d:` → terminal)

iMessage → terminal **stays** (Carson's decision). While blocked it is refused with a reply, not queued.
- `dispatchCommand` (`:252`): add an optional third parameter `target: ImessageBridgeTerminalDispatcher | null = dispatcher` (test seam) and use `target` in place of the module `dispatcher`.
- First statements:
  ```ts
  const admission = checkExecutionAdmission('imessage-command')
  if (!admission.allowed) {
    console.warn(`[imessage-bridge] command not sent: ${admission.reason}`)
    await sendImessage(selfHandle, '(Dobius+ crew is paused; command not sent to the terminal)').catch((error) => {
      console.warn('[imessage-bridge] pause reply failed:', error instanceof Error ? error.message : String(error))
    })
    return
  }
  ```
  Do not log the command text on the blocked path.
- The watermark update at `:214-216` is unchanged, so a command refused while paused is **not** replayed when the crew resumes. State this in the PR.
- Export `bridgeServiceInternals = { dispatchCommand }` for tests.

### 3.9 `R/components/kanban/board-dispatch.ts` (Kanban)

Main already refuses the run (RPC `agent.run` → `startAgentRun`, default origin). This renderer check only stops the card being claimed and an attempt burned.
- In `poll()` (`:158-181`), first line inside `try`:
  ```ts
  // Why: claiming while paused would mark the card failed when main refuses the run.
  const paused = await window.api.agents.getPaused().catch(() => true)
  if (paused) return
  ```
  An IPC failure counts as paused (fail closed).
- `:201`: `export const boardDispatchInternals = { isReady, buildPrompt, poll }`.

### 3.10 Not changed here (on purpose)

- Voice Conductor (`M/voice-conductor/conductor.ts:123-167`, `agent-spawn.ts:71`): refused inside `startAgentRun`. `kick()` sets `lastError` to the gate message (`:161-165`), visible in `getStatus()`. No edit.
- Communications chat, workflows, providers, CLI `agent.run`: refused by default origin. Chat shows the error. **Behavior change:** Communications chat is blocked while paused (Decision for Carson; recommended default: blocked).
- `/tabSend` (`M/dobius-cli/dispatch-server.ts:276`): loopback + bearer token, a local human tool, not an autonomous producer. Not gated. Guarded in BUILD-032.
- Jarvis `run_dobius` (C3, by design): not gated. If it runs `dobius agent run`, that reaches `startAgentRun` and is refused.
- Automations and `orchestration.run`: BUILD-002 (engine).
- UI wording and effective-state display: BUILD-004 (#119).

## 4. Tests to add (vitest, `dobius/config/vitest.config.ts` includes `src/**/*.test.ts`)

| File | New / extend | Cases |
|---|---|---|
| `dobius/src/main/agents/agents-config-store.test.ts` | new (mock `electron` `app.getPath` to a `mkdtemp` dir, like `asana-dispatch-ledger.test.ts:6-28`) | missing file → `status:'missing'`, `paused:false`, no file created; malformed JSON → `paused:true`, `unreadable`, **file bytes identical** after `getAgentsPaused`, `consumePingBudget`, `setAgentsPaused(true)`, and a forced stale `pingDate`; `{"agentsPaused":"yes"}` → unreadable; `setAgentsPaused(false)` on unreadable throws; EACCES via `chmod 000` (skip on win32 and when running as root) → unreadable; repair the file → next call returns `ok` without `vi.resetModules`; valid file rollover still persists |
| `dobius/src/main/agents/execution-gate.test.ts` | new (mock `./agents-config-store`) | unpaused → all origins allowed; paused → only `agents-page`; unreadable → only `agents-page`; `getAgentsControlState` throws → denied `control-state-unreadable`; `assertExecutionAdmitted` throws an error with `name === 'ExecutionBlockedError'`; `isExecutionBlockedError(new Error('x'))` false |
| `dobius/src/main/agents/agent-runner-admission.test.ts` | new (mock `@anthropic-ai/claude-agent-sdk`, `./agents-store`, `./agent-runs-store`, `./agent-run-events`, `./agent-runner-environment`, `./codex-agent-execution`, `./agents-config-store`) | paused + no origin → rejects `ExecutionBlockedError`, `query` never called, no run stored; nine blocked calls then one unpaused call succeeds (proves no reservation leak past `MAX_CONCURRENT_RUNS = 8`); pause flipped while `prepareClaudeLaunch` is pending → rejects, `query` not called, next run admitted; `origin:'agents-page'` while paused → `query` called; Codex agent while paused → `startCodexAgentProcess` not called |
| `dobius/src/main/agents/asana-dispatch-ledger.test.ts` | extend | `releaseClaim` on fresh claim removes it (claimable again); on reclaimed failed record → `failed`, same `attempts`; on `briefed`/`dead` → unchanged |
| `dobius/src/main/agents/asana-auto-mode-admission.test.ts` | new | blocked → `claimTask` not called; `startAgentRun` rejecting with `ExecutionBlockedError` → `releaseClaim` called, `recordFailure` not called; any other error → `recordFailure` as today |
| `dobius/src/main/agents/agent-tools/dobius-tool-server.test.ts` | extend (add `vi.mock('../execution-gate')`) | blocked → `dispatch_build` returns `isError` text containing `blocked`, build dispatcher not called; allowed → unchanged |
| `dobius/src/main/agents/agent-channel-service.test.ts` | extend | `startAgentRun` rejects with `ExecutionBlockedError` → reply contains `paused`; other error → reply contains `busy` |
| `dobius/src/main/imessage-bridge/bridge-service-admission.test.ts` | new (mock `./imessage-send`, `../agents/execution-gate`, `../sqlite/sync-database`, `../agents/agent-channel-service`) | blocked → `sendTerminal` not called, pause reply sent; allowed → `resolveActiveTerminal` + `sendTerminal({enter:true})` called once |
| `dobius/src/renderer/src/components/kanban/board-dispatch.test.ts` | extend (stub `globalThis.window.api`) | `getPaused` → true: `vertexTasks.list`/`update` never called; `getPaused` rejects: no `update`; false: `list` called |

## 5. Verification commands

Run inside the build worktree, never in `/Applications`, and never launch the packaged app from an agent. Use `learned-dobius-typecheck-configs` (bare `npx tsgo --noEmit` does not work here) and `learned-dobius-commit-hygiene` before committing.

```bash
cd "/Users/bayou/Projects (Code)/Dobius/dobius-plus/.claude/worktrees/001-global-execution-gate/dobius"
node --version                      # record; repo wants 24 (package.json engines)
pnpm run typecheck                  # tsgo, three configs; must exit 0
npx vitest run --config config/vitest.config.ts \
  src/main/agents src/main/imessage-bridge src/renderer/src/components/kanban
pnpm test                           # full suite; compare failures with the Phase 0 baseline list
npx oxlint src/main/agents/agents-config-store.ts src/main/agents/execution-gate.ts \
  src/main/agents/agent-runner.ts src/main/ipc/agents.ts \
  src/main/agents/agent-tools/dobius-tool-handlers.ts src/main/agents/asana-auto-mode-service.ts \
  src/main/agents/asana-dispatch-ledger.ts src/main/agents/agent-channel-service.ts \
  src/main/imessage-bridge/bridge-service.ts src/renderer/src/components/kanban/board-dispatch.ts
rg -n "origin: 'agents-page'" src      # expect exactly one hit: src/main/ipc/agents.ts
rg -n "startAgentRun\(" src/main | rg -v test   # every caller reviewed against section 3.10
```
A fresh worktree may lack `node_modules`; follow `learned-dobius-typecheck-configs` for that case. Pre-existing lint errors in touched files must be fixed in this build, not bypassed (`--no-verify` is banned).

Manual check (Carson, after a gated install, with Gate A settings):
1. Crew paused. Move a Kanban card assigned to an agent into To Do → card stays To Do, no attempt counted.
2. Send `d: echo hi` by iMessage → reply "crew is paused", terminal untouched.
3. Voice Conductor status shows "Crew is paused…" as its last error after a transcript.
4. Agents page → Run a manual agent → it runs.
5. Copy `agents-config.json` aside, write `{` into it → all of the above stay blocked and Resume fails with the file path. Restore the copy → Resume works without restarting.

## 6. Rollback

Revert the merge commit. No file format changes. `agents-config.json` written by this build is readable by old code. Ledger records removed by `releaseClaim` were claims that never launched, so the old code simply re-evaluates those tasks. After rollback, the fail-open behavior of #1/#2 returns, so Gate A closes again.

## 7. What the reviewer must check

1. `startAgentRun` checks before any reservation and again after the `prepareClaudeLaunch` await; the catch releases the reservation on the second check.
2. Default origin is autonomous. Exactly one `'agents-page'` caller (`M/ipc/agents.ts`).
3. No code path writes `agents-config.json` while the state is unreadable (grep every `persist(` call in the store).
4. `ENOENT` behavior is unchanged (unpaused), and that choice is written in the PR.
5. `dispatch_build`, iMessage `d:`, iMessage `@Agent`, Kanban poll and Asana claim each have a test that proves they are blocked while paused.
6. A blocked Asana start releases the claim and does not count a failure; a blocked Kanban poll does not claim.
7. No new empty `catch`; every `.catch` logs or returns a denial. No `@ts-ignore`.
8. Log lines contain the file path and errno code, never file contents, prompts, iMessage text or tokens.
9. C2 and C3 untouched. iMessage → terminal works again when unpaused.
10. No engine file edited (`git diff --stat` shows only the files in section 3). No UI redesign.
