# REPAIR CX12 — Codex review fixes (F1, F2, F4, F6, F7)

Branch `stabilize/CX12-codex-review-fixes` from `stabilize/integration` (5db54ff3).

## F1 [high] runs store saved a filtered array over the original
Root cause: `agent-runs-store.ts` `sanitizeRuns` dropped malformed entries with
`flatMap`, the load still counted as `ok`, and startup reconciliation then
persisted the filtered list (`[{"id":123}]` -> `[]`).

Fix: new shared `parseEveryEntry(entries, parseEntry)` in
`storage/safe-json-file.ts` returns `undefined` (-> SafeJsonFile `unreadable`:
quarantine copy, writes refused) when any entry is malformed. `sanitizeRun`
requires the five fields every writer has set since the store was introduced
(caee2df0, checked in git history and in `agent-runner.ts` `addRun`): non-empty
`id` and `agentId`, string `prompt`, finite `startedAt > 0`, and a known
`status`. Optional fields are still normalized field by field; unknown fields
are ignored (the removed `outbox` field of b821450f-era files, and BUILD-008's
coming `permissionDenials`, do not make a file unreadable).

## F2 [high] dispatch ledger dropped a malformed record
Root cause: `asana-dispatch-ledger.ts` dropped invalid records and defaulted
missing numbers, so a damaged record carrying `buildDispatchedAt` vanished and
the task looked new (second paid build).

Fix: `sanitizeRecord` rejects any record without gid/lane/status, finite
`firstSeenAt`, `lastAttemptAt`, `attempts >= 0`, or with a present but
non-finite `buildDispatchedAt`; `parseEveryEntry` makes the whole ledger
unreadable, so `claimTask` returns null, `mayDispatchBuild` returns false and
`recordBuildDispatched` refuses to save (existing fail-closed code paths).
Every writer since caee2df0 has written all six required fields.

Same rule, every other BUILD-009 store that filtered entries:
- `agents-store.ts`: entry without id or name -> unreadable (was dropped).
- `agent-notification-store.ts`: any malformed `entries[]` item, or a non-array
  `entries`, -> unreadable. A missing `entries` key still loads as empty.
- `agent-briefing-store.ts`: item without id/agentId/ts/summary -> unreadable.
- `agent-draft-store.ts`: draft without id/agentId/target.gid/createdAt -> unreadable.
- `asana/asana-config.ts`: a malformed `allowedProjects` entry in the saved file
  -> unreadable (new `parseStoredConfig`). `sanitizeConfig` itself (also used for
  renderer updates) is unchanged.
- `communications/team-store.ts`: team without id or name -> unreadable.
Validity checks are exactly the old drop conditions, turned into rejections, so
any file the old loader accepted in full still loads.
Not changed on purpose: field-level normalization inside a valid entry
(defaults for missing optional fields, `allowedTools`/`sessionsByKey`
filtering, team `accountIds` token-shaped scrub, which is a deliberate secret
filter).

## F4 [high] automations launched after Pause crew
Root cause: `automations/service.ts` admitted a scheduled run once, then awaited
the headless precheck (and the renderer awaited SSH and precheck) before
launching, with no second check. `automation.runNow` over RPC/CLI bypassed the
gate as a "manual" run.

Fix:
- `requestDispatch(automation, run, honorExecutionGate)` re-checks
  `checkExecutionAdmission('agent-run')` right before the renderer send and
  before the headless path; blocked -> `skipped_unavailable` with the gate's
  message (BUILD-002 pattern).
- Headless: re-checked after the precheck await, right before the dispatcher;
  blocked -> `skipped_unavailable`.
- `AutomationDispatchRequest.honorExecutionGate` tells the renderer; the renderer
  hook re-reads `agents.getExecutionState()` right before the precheck and right
  before workspace creation / agent launch. Unreadable state or a failed read
  blocks (fail closed).
- `runNow(id, humanTrigger = false)`: only the desktop IPC
  (`ipc/automations.ts`) passes `true`. RPC/CLI (`runtime.runAutomationNow`)
  now honors the gate.
- Line budget: `service.ts` sits at the 300-line cap; the unavailable-precheck
  result literal moved to `shared/automation-precheck.ts`
  (`buildUnavailablePrecheckResult`, same values).

## F6 [high] cross-agent rail bypass by shell variable construction
Investigation: the Claude Agent SDK here (`@anthropic-ai/claude-agent-sdk`
0.3.201, `sdk.d.ts` `Options.sandbox: SandboxSettings`) does have a process
boundary primitive: `sandbox.enabled`, `filesystem.denyRead/denyWrite`,
`credentials.files[{mode:'deny'}]`, `allowUnsandboxedCommands:false`,
`failIfUnavailable`. Not wired in this build because (1) the options are built
in `agent-runner.ts`, which BUILD-008 owns in parallel (brief: do not edit),
and (2) enabling the sandbox also turns on network allow-listing and write
confinement for every Bash command, which cannot be verified here (no Electron
launch, no network) and could break normal agent work (git push, npm, curl).
Recommended as a follow-up (Decisions for Carson).

Rail fix instead (defense that does not need the sandbox), new module
`agent-hard-rails-shell.ts`, called from `evaluateAgentHardRails` for Bash
after the credential and identity rails:
- deny a command using an expansion the rail cannot resolve: `$(...)`,
  backticks, `${...}`, `$NAME`, positional `$1`, ANSI-C `$'..'`, `eval`;
- allowed: expansions inside single quotes or escaped (`awk '{print $1}'`),
  arithmetic `$((..))`, `$? $# $$ $! $-`, a few fixed env vars not used as a
  directory prefix (`echo $PATH`, `...:$PATH`), and `for` loop variables over
  literal relative words (`for f in *.ts; do wc -l "$f"; done`) when the run's
  cwd cannot reach `~/.dobius` and the command has no home literal, `~`, `..`
  or bare `cd`;
- the SDK hook's `cwd` is now passed to the rails; an unknown cwd, a cwd of `~`,
  or a cwd inside `~/.dobius` disables the loop-variable allowance;
- `$USER`/`$LOGNAME` are now expanded like `$HOME` for the path rails.
Trade-off (Decisions for Carson): commands like `x=$(git rev-parse HEAD)`,
`npm version $(...)`, `--since="$(date)"`, `while read f` loops are denied;
the agent gets the reason and can write the value out literally. Agents with no
working directory run in `~`, so they lose loop variables too.
Residual (not fixable by text rails, needs the sandbox): globs
(`cat ~/.dob*/agents/*/MEMORY.md`), whole-home walkers (`find ~ -name MEMORY.md
| xargs cat`, `grep -r x ~`), files written in one call and executed in the next.

## F7 [medium] force-push hidden in a variable
Fix (`isUnverifiablePush`, same module): a `git push` segment is denied when the
command has command substitution, an assignment or variable setter in command
position (`F=--force;`, `export`, `read`, `env A=..`, `GIT_CONFIG_*=..`,
`source`, `eval`, `alias`), when the push segment holds `$` or a backslash, or
when `-c`/`--config-env` precedes `push`. `isForcePush` moved unchanged into the
module (line budget of `agent-hard-rails.ts`).

## Tests
- `storage/safe-json-store-migrations.test.ts`: every store with one malformed
  entry next to a valid one stays byte-identical, one quarantine copy, no temp;
  `[{"id":123}]` never rewritten; ledger with bad `buildDispatchedAt` fails
  closed; well-formed files for all eight stores still load.
- `automations/service-admission.test.ts`: RPC runNow while paused is skipped;
  desktop runNow still dispatches (`honorExecutionGate:false`); scheduled
  payload carries `honorExecutionGate:true`; headless run paused during its
  precheck is skipped and the dispatcher is never called.
- `ipc/automations.test.ts` (new): desktop IPC passes `humanTrigger=true`.
- `renderer/.../useAutomationDispatchEvents.test.ts`: paused before launch ->
  no worktree/agent; paused during the precheck -> skipped; state read failure
  -> skipped.
- `agents/agent-hard-rails.test.ts`: 10 constructed-path bypasses denied, 10
  ordinary commands allowed, cwd handling, hook passes SDK cwd; 8 F7 pushes
  denied, literal pushes allowed.

Mutation checks (each test seen failing, then restored):
- `parseEveryEntry` `return undefined` -> `continue`: all 8 store cases + F1/F2 tests fail.
- ledger `buildDispatchedAt` check reverted to old drop-the-field: 2 ledger tests fail.
- headless re-check removed: headless test fails (`dispatch_failed`).
- runNow always ungated: RPC test fails. IPC `true` removed: IPC test fails.
- renderer re-check disabled: 3 renderer tests fail.
- `buildsUnresolvableShellPath` -> false: 7 bypass cases + cwd/hook tests fail
  (the other 3 are also caught by the identity rail).
- `isUnverifiablePush` -> false: all 8 F7 cases fail.

## Verification
- `pnpm run typecheck`: exit 0.
- Targeted vitest (agents, storage, asana, automations, communications, ipc
  automations, renderer dispatch hook, rpc automations, host client): 1164
  passed. Failing: `communications/providers/agent-provider.test.ts` (in
  basefail), `communications/verify/auth-handshake-integration.test.ts` (port
  3300 held by the live Dobius+ app), `communications/verify/run-verification.test.ts`
  (reads the live relay: note count 9, then 10 on a rerun; environmental).
- `service-admission.test.ts` first two tests time out (30 s) on a cold module
  cache under parallel-builder load and pass on rerun (reproduced after a
  whitespace-only touch of service.ts, so it is load/cold-start, not logic).
- oxlint (both configs) clean on every changed file.
- Full suite: DEFERRED (coordinator).

## Rollback
Revert the commit. No data migration: files made unreadable by the stricter
parsers are untouched on disk (quarantine is a copy); reverting restores the
old lenient load.

## Merge note
BUILD-008 adds `permissionDenials` to the run record and a
`sanitizePermissionDenials` parser in `agent-runs-store.ts`. `sanitizeRun`
ignores unknown fields, so that field never makes a file unreadable; the
merge must add its parse line inside `sanitizeRun` (this build de-indented the
old `flatMap` body into that function, so a textual conflict is expected).
