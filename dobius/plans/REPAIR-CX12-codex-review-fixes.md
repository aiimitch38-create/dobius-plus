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

## Review follow-up (second commit)
Merge first: `stabilize/integration` (ceee29a5, BUILD-008) merged; the
`sanitizePermissionDenials` parse sits inside `sanitizeRun` (a malformed denial
is dropped, the file stays readable). Test added in
`safe-json-store-migrations.test.ts`.

The F6 root fix (SDK sandbox) moved to build SBX; the text rail now closes the
reviewer's concrete bypasses and false positives only.

- F5 (false positives): quoted-delimiter `cat` heredoc bodies are literal and
  are stripped before the expansion and git rails (`agent-hard-rails-shell-text.ts`
  `stripLiteralHeredocs`); `$(cat <<'X' ... X)` becomes a literal. A heredoc
  piped on (`cat <<'EOF' | bash`) is kept. The F7 assignment check is scoped to
  the push segment's own prefix plus `GIT_*` assignments anywhere, so
  `NODE_ENV=test npm test && git push` is allowed.
- F3: git tokens are dequoted like the shell (`'`, `"`, `\` dropped) before
  matching git/push/flags; `xargs|parallel|-exec ... git push` is unverifiable;
  `git config` / `git -c` writes to `alias.*` or `remote.*.push|mirror` are
  denied; redefining `git` as a function/alias next to a push is denied.
  Known limit: an alias or config written by an EARLIER tool call cannot be
  seen by a per-command rail (the write itself is denied; SBX covers the rest).
  Git rails moved to `agent-hard-rails-git.ts`.
- F1: the inner string of `sh|bash|zsh|dash|ksh|fish -c` (also via env,
  command, exec, xargs) runs through every rail recursively (depth cap 4, then
  deny).
- F2 stopgaps: brace expansion `{a,b}` / `{x..y}` in unquoted text (a whole-word
  numeric range like `{1..3}` stays allowed), backslash-newline inside a word,
  `xargs -I/-J` when the command mentions `agents/` or `.dob`, and a loop
  variable used as a path prefix whenever any `cd` appears. Residual covered by
  SBX: globs (`~/.dob*`), whole-home walkers.
- F4: the renderer re-checks Pause crew right after the worktree resolves
  (before setup tabs), after `listRuns` on the reuse-session path, and right
  before `launchAgentBackgroundSession`.
- Line budget: `collectStrings`/`stringsToInspect`/`rawStringMentionsCredential`
  moved unchanged to `agent-hard-rails-inputs.ts`.

Mutation checks (each seen failing, then restored): heredoc strip off (4 F5
tests), global assignment check restored (NODE_ENV test), no dequote (6 tests),
no xargs push rule, no config-write rule (2), no sh -c recursion (2), F2
stopgaps off (4), xargs -I rule off, split-cd off, backslash-newline off,
renderer post-create re-check off.

## Review r2 (third commit)
- r2 F1 [high]: `stripLiteralHeredocs` now strips ONLY one whole double-quoted
  argument `"$(cat <<'X' ... X\n)"`, and never when its segment contains
  sh/bash/zsh/dash/ksh/fish/eval/source/`.`. The standalone `cat <<'X'` strip is
  gone, so `> p.sh`, `> >(sh)`, `<(..)`, a bare `$(..)` command word and pipes
  keep their bodies scanned.
- r2 F2: `sh -c` parsing is a small tokenizer: `--long`, `-o/-O/+o/+O <word>`,
  `+x` and letter clusters before the -c cluster; optional `--` after it; the
  operand is one shell word (quotes joined). An unreadable operand (e.g. an
  unterminated quote) denies with UNRESOLVABLE_SHELL_PATH_REASON.
- r2 F3: `inspectStrings` uses the stripped text for the Bash `command` field,
  so credential/identity rails no longer see commit-message text.
- Also fixed: git push/config detection uses git's subcommand (first non-option
  word after git), so `git commit -m "... git push -f ..."` is allowed.
- Reviewer probe: 54/55 rows as expected. The one remaining row,
  `for f in a.ts b.ts; do npx oxlint $f; done` with cwd = home, is denied by
  design (a home cwd can reach ~/.dobius; recorded under Decisions for Carson).
- Tests: `agent-hard-rails.test.ts` "CX12 r2 review" block. Run against the
  previous commit's rail code: 17 of 25 fail (all 10 F1 shapes except the eval
  pair, 4 F2 cases, 3 F3 allows); the rest were already green and stay as
  regression guards.

## Review r3 (fourth commit) — coarse, fail-closed text rail (last round)
New `agent-hard-rails-bash-data.ts` `prepareBashCommand` decides what is data:
- Message args: a quoted `-m/--message/--title/-t/--body/-b` argument of a
  `git`/`gh` command (including `"$(cat <<'X' ... X)"`) becomes `"MSG"`. Any
  `$(..)` inside it is evaluated as its own command. Not stripped when the
  whole command has `|`, `<(`, `>(`, `eval`/`source`, or `$`/backtick in
  command position.
- Data heredocs (r3 F3, F6): the body of a quoted-delimiter heredoc fed to
  `cat` (both operand orders), `git commit -F-/--file=-` or `gh --body-file -`
  is removed only when the WHOLE remaining command has no code-runner word
  (sh bash zsh dash ksh fish eval source exec env command xargs python python3
  node deno bun perl ruby php awk gawk osascript lua, `.` as a command), no
  `|`, no `<(`/`>(`, no `$`/backtick in command position, and no later run of
  a written file (`./x`, `chmod +x`). A heredoc inside `$(..)`/backticks is
  never data. Otherwise nothing is stripped and every rail (git, path,
  identity, credential, sh -c) scans the whole text.
- Git (r3 F1, F5): in any segment with a `git` token, any later `push` token
  makes the whole segment's tokens subject to the force checks (-f/-d
  clusters, --force*, --mirror, --delete, +refspec, :branch); no git option
  parsing. `--config-env` keys count like `-c` for alias/remote.*.push writes;
  `config` anywhere after git counts.
- The r2 `stripLiteralHeredocs` was removed; `agent-hard-rails-shell-text.ts`
  now only parses `sh -c`.

Reviewer harness (cx12r3/probe.test.ts, 143 rows):
- r3 review commit b8cded74 (reviewer's out.txt): 112 ok / 31 mismatch;
  reviewer's older comparison (out-old.txt): 110 ok / 33 mismatch.
- this commit: 142 ok / 1 mismatch (the documented home-cwd loop row).
Repo tests: "CX12 r3 review" block (34 cases); against b8cded74's rail code
22 fail (every F3/F6 heredoc row, the gh title substitution, 6 interpreter /
re-used heredoc shapes, all 8 git fail-closed rows); the 12 others already
passed and stay as regression guards.

Documented limits (Decisions for Carson): interpreter code that builds paths or
runs git through its own APIs (python subprocess, node fs, perl system with
text the rail cannot see) is out of scope for text rails; files are covered by
SBX (SDK sandbox). For force-push, turn on GitHub branch protection for main
(server side, cannot be bypassed from this machine).
