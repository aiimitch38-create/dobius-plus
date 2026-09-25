# REPAIR BUILD-031 — ADAM admission handshake

Item: X12 (architecture gap, `BUG-LIST-123.md:192`; `BUG-MATRIX.md:150`; `PHASES.md:65`).
Depends on BUILD-001 (execution gate), BUILD-007 (dispatch_build handler), BUILD-030 (`adam-connection.ts`).

## Root cause (re-traced on 2026-09-25 at `stabilize/integration` 0068b5cb)

- `dobius/src/main/agents/execution-gate.ts` `checkExecutionAdmission` was pause-only: it read the
  crew control state and nothing else. No Dobius path asked ADAM whether a project may be written to
  before starting an agent; ADAM only saw agent events after the fact through the event journal, which
  (BUG-MATRIX X12) "does not satisfy pre-execution gating".
- `dobius/src/main/agents/agent-tools/dispatch-build-handler.ts:99-102` (pre-fix) called only the pause
  gate, then created a worktree and launched a paid terminal agent. A triage run could therefore dispatch a
  build into a project ADAM's registry does not allow (per the review of the deployed registry:
  `read_only` omniroute and personal-finances, disabled dobius-hub, or any unregistered path). PCIF,
  Pocket Cologne, BetterHealthNow and ADAM are managed/verified there; ADAM's own
  `plans/CONTEXT-HANDSHAKE.md` still describes them as read_only, which is out of date on the ADAM side.
- The repo lister (`agent-dispatch-registry.ts` `RepoLister`) returned only `{id, name}`, so the handler
  had no path to hand ADAM.

## ADAM contract (read-only reference)

ADAM commit 7599619 (`feat/context-handshake-route`, not deployed): `plans/CONTEXT-HANDSHAKE.md`,
`service/src/runtime/service.ts:512-535`, `service/src/projects/handshake.ts:173-199`.
`POST /v1/context-handshake`, bearer auth, body `{worktreePath, intent: 'dispatch'|'launch', readinessLevel?}`.
200 `{ok:true, contextPack:{projectId,digest,toolPolicyTier}}`; 403 `{ok:false,error,code,reason}` with code
in unknown_project | project_not_managed | location_unverified | readiness_too_low (or no code on any other
resolver throw); 400 invalid body; 401 unauthorized.

## Fix

- `execution-gate.ts`: new `checkBuildDispatchAdmission(repoPath, {timeoutMs?})` →
  `BuildDispatchAdmission` (the pause-only `ExecutionAdmission` plus `adam-unavailable` / `adam-refused`;
  kept as a separate type so the pause-only callers, e.g. `session-workspace-facts.ts:100-103`, keep their
  narrow reason type). Order: pause gate → ADAM handshake → pause gate again (a pause while ADAM answers
  still wins).
- The handshake reuses BUILD-030's `resolveAdamTarget` (loopback/tailnet allowlist, blocked-endpoint) and
  `resolveAdamToken` (not-installed / no-token). No new ADAM client module. `AbortSignal.timeout(5_000)`
  bounds connect, headers and body. Fail closed:
  - 200 with `ok:true` and a `contextPack.projectId` string → admit. Any other 200 → block.
  - 403 → `adam-refused`, message carries ADAM's code (only if one of the four known codes) and ADAM's reason
    (trimmed to 300 chars).
  - 404 → `adam-unavailable` "ADAM needs updating: it has no context-handshake route".
  - 401 → `adam-unavailable` "ADAM rejected the Dobius+ token (HTTP 401)".
  - 400 / 5xx / other → `adam-unavailable` "ADAM answered HTTP n".
  - fetch throw → "ADAM offline: <errno>" (fetch's `cause.code`, e.g. ECONNREFUSED); timeout →
    "ADAM offline: no answer within 5000 ms". Blocked endpoint / not installed / no token → blocked, no request.
  - Messages never include the token (only status codes, errno, and ADAM's own reason).
- `dispatch-build-handler.ts`: after the repo is resolved and the dispatcher exists, and before the ledger
  mark, the capacity slot and worktree creation, `await checkBuildDispatchAdmission(repo.path)`; a block
  returns `build dispatch blocked: <message>`. The early pause check stays so a paused crew costs no lookup.
  The capacity check and increment remain synchronous after the await, so the one-in-flight guarantee holds.
- `agent-dispatch-registry.ts` + `ipc/register-core-handlers.ts`: `RepoLister` entries now carry `path`
  (`repo.path` from `runtime.listRepos()`).

## Decision recorded: which path ADAM checks

The repo path, before the worktree exists, with intent `launch`. Why: it blocks before any side effect
(no worktree, no branch, no ledger mark, no agent tokens), ADAM matches by `/`-boundary path prefix, and
this is exactly what ADAM's own `/v1/workers/launch` resolves (`preflight.repo.path`). Checking the created
worktree path would need a second hook between worktree creation and agent start inside
`runtime.createManagedWorktree` (startup agent is launched there), i.e. after a side effect. Consequence: a
worktree created outside the repo folder is still judged by its repo's registration.

## Decisions for Carson (recorded defaults, flip later)

- ADAM offline / not installed / no token / blocked endpoint / 401 / 404 / 5xx / timeout → dispatch_build
  BLOCKED. Manual runs (Agents page), heartbeat/automation/iMessage runs stay pause-only — only
  `dispatch_build` consults ADAM.
- No `readinessLevel` is sent (ADAM then uses tier `restricted`).
- Remote (SSH) repos: their path is a remote path; ADAM will refuse it as `unknown_project` unless registered.

## Tests

- New `src/main/agents/execution-gate-adam.test.ts` — a fake ADAM `http.createServer` on an ephemeral
  127.0.0.1 port (`ADAM_SERVICE_URL` pointed at it; `DOBIUS_ADAM_PROJECT_DIR` pointed at an empty temp dir so
  the real service/token are never touched): admit + request shape (path, intent, bearer); each of the four
  refusal codes; 403 without code; 404; 401 (token not echoed); 500/503/400; 200 without a pack; connection
  refused; timeout (200 ms); blocked Settings endpoint (no request sent); not installed (no request sent);
  pause first and re-checked after; all origins incl. the manual `agents-page` make no ADAM request.
- `agent-tools/dobius-tool-server.test.ts`: mock extended with `checkBuildDispatchAdmission`; new test that
  a refusal is asked with the repo path, blocks before dispatch, and holds no ledger mark or capacity; repo
  fixtures gain `path`.

## Mutation checks (each seen FAIL, then restored and green)

1. ADAM call replaced by `{allowed:true}` → 17 failed.
2. 403 admitted → 5 failed.
3. Post-handshake pause re-check removed → 1 failed (pause test).
4. `AbortSignal.timeout` removed → 1 failed (timeout test).
5. 200 admitted without a context pack → 1 failed.
6. Handler wiring removed → 1 failed (tool-server ADAM test).
7. 404 admitted → 1 failed.

## Verification

- `pnpm run typecheck` exit 0.
- `npx vitest run --config config/vitest.config.ts src/main/agents src/main/adam-connection.test.ts
  src/main/runtime/orchestration src/main/imessage-bridge` → 712 passed, 2 skipped.
- `src/main/ipc/register-core-handlers.test.ts` fails on `ipcMain.removeHandler` in
  `registerVertexTaskHandlers`; it is in the pre-existing baseline (`basefail.txt`), unrelated.
- oxlint (default + react-doctor) clean on all changed files. Full suite: deferred to the coordinator.

## Review follow-up (second commit)

- F1: `dispatch-build-handler.ts` took the first repo whose name matched. Carson's list has two repos named
  `dobius-plus` (the stale non-git `~/Projects (Code)/dobius-plus` and the real
  `~/Projects (Code)/Dobius/dobius-plus`), and ADAM refuses the stale one (`unknown_project`), so builds
  requested by name never ran. An exact id still wins. A name that matches more than one repo is now refused,
  and the message lists each match as `id (path)` so the agent can retry by id. "Repo not found" now lists
  `name (id)`. Tests: ambiguous name refused before ADAM/dispatch, dispatch by id with twins, not-found list.
- F3: `response.json().catch(() => undefined)` swallowed a TimeoutError during the body read, so the block
  said "answered without a context pack". A TimeoutError is now rethrown, so the message says it timed out.
  Test: the server sends headers and half a body, then stalls.
- F2: corrected the registry description above and the tool-server test fixture (it now uses omniroute).
- Mutation checks: took the first name match instead of refusing → the ambiguity test failed; restored the
  swallow-all catch → the F3 test failed.

## Rollback

Revert the commit; the gate returns to pause-only and `RepoLister` to `{id, name}`.

## Lessons

- Node's `fetch` reports a refused connection as `TypeError: fetch failed` with the errno on `cause`, and
  `AbortSignal.timeout` as a DOMException named `TimeoutError` with numeric `code` 23 — read `cause`/`name`,
  not `code`, for a readable reason.
