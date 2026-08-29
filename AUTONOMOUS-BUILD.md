# Dobius+ — Autonomous Build: Adam control, memory, proactive, plugins

You are building four features on branch `feat/adam-voice-control` in the
worktree `/Users/bayou/Projects (Code)/dobius-adam`. The full design is in
`plans/TASK-ADAM-CONTROL.md` — READ IT FIRST, it is the specification.

Where this file and the plan disagree, **this file wins**. It was revised after
a pressure test that found real defects in the plan.

## Hard rules

1. **Work only in this worktree.** `/Users/bayou/Projects (Code)/dobius-adam`.
   Never touch `/Users/bayou/Projects (Code)/Dobius/dobius-plus` — another
   agent has uncommitted work there and writing to it destroys their session.
2. **Never `git checkout` another branch here.** This worktree is pinned to
   `feat/adam-voice-control`.
3. **Do not install into `/Applications/Dobius+.app`.** Every reinstall
   re-signs the computer-use helper and voids Carson's Accessibility grant.
   Build to verify compilation only. Carson installs manually at the end.
4. **Never use `--no-verify`.** If a hook fails, fix the cause.
5. **Never commit credentials.** The ElevenLabs key lives in app settings, not
   in the repo. If you find one in a diff, stop and report it.
6. **Stay inside the blast radius.** You may only create or modify files under
   `dobius/src/main/jarvis/`, `dobius/src/main/window/`,
   `dobius/src/renderer/src/components/jarvis/`,
   `dobius/src/renderer/src/components/settings/`, `dobius/src/preload/`,
   `dobius/src/shared/speech-types.ts`, `plans/`, `BUILD-LOG.md`, `HANDOFF.md`,
   `LESSONS-LEARNED.md`. Anything outside that list is out of scope — if a task
   seems to need it, STOP and write the blocker into `HANDOFF.md` instead.
7. **Never edit or delete a test you did not write.** See "The test baseline"
   below — the repo has hundreds of pre-existing failures that are not yours to
   fix and not a signal that you broke something.
8. Read `LESSONS-LEARNED.md` before the first task and obey every entry.
9. If verification fails twice on the same task, append the failure pattern to
   `LESSONS-LEARNED.md` before continuing.

## Two security invariants that override any task description

**A. Execution is never authorised by the model.** Adam may *propose* a shell
command. Only a human click in the review window may *run* it. Do not expose an
"apply"/"approve" client tool for shell commands — the renderer's `clientTools`
map must contain no tool that can cause a queued command to execute. The only
caller of the execute IPC is the review window's own button.

Why this is called out: the existing self-edit flow does NOT have this property.
`use-voice-agent.ts:115` exposes `apply_code_change` as a client tool, and
`SelfEditView.tsx:105` is the human button — both invoke `jarvis:applySelfEdit`.
So today Adam can approve his own code edit. That is tolerable for a diff (it is
on screen, a backup is written, it is reversible). It is NOT tolerable for
`mv ~/Projects /tmp`. Do not copy the self-edit pattern here. Do not "fix"
self-edit either — out of scope, note it in `HANDOFF.md`.

**B. Adam may never write into the plugin directory.** Plugins are unsigned code
running in the main process. If Adam can write a file there, then one approved
innocuous-looking write becomes permanent unapproved code execution on every
launch. Add the resolved plugin directory to the forbidden paths of BOTH the
self-edit resolver (`self-edit.ts` `FORBIDDEN_SEGMENTS`) and the shell tool, and
test it. Carson installs plugins by hand.

## Environment notes that will bite you

- The app source is in `dobius/`. Run all pnpm commands from there.
- `pgrep`/`pkill` patterns must escape the plus: `Dobius\+`. An unescaped
  `Dobius+` means "Dobiu followed by one or more s" and never matches.
- zsh does not word-split unquoted variables. `for f in $FILES` passes the
  whole list as one argument. Use `while IFS= read -r`.
- Paths contain spaces and parentheses. Always quote them.
- `pnpm run build:unpack` fails if `out/` is stale — `rm -rf out dist` first.
- Typecheck: invoke the `learned-dobius-typecheck-configs` skill first. Bare
  `npx tsgo --noEmit` does NOT work in this repo.
- Lint is `npx oxlint <paths>`. It uses `oxlint-disable`, not `eslint-disable`.
  Never disable `max-lines` — split the file instead.
- Do not add a `no-control-regex` suppression; build the pattern with
  `String.fromCharCode` instead (see `terminal-history-context.ts`).

## The test baseline — read this before you run vitest

On a clean checkout of this branch, **the repo already has 566 failing tests
across 542 files** (updater feed fetches, `communications/verify` relay
integration, `persistence`, `repo-icon-autodetect`). They fail on the base
commit, they are unrelated to this branch, and they are almost all
network/environment dependent. **They are not your problem. Do not fix them. Do
not let them block a task.**

Your gate is the scope this build touches:

```
npx vitest run src/main/jarvis src/main/window src/renderer/src/components/jarvis
```

Baseline on the clean branch: **221 tests passing**, plus one pre-existing
file-level failure (`src/main/window/attach-main-window-services.test.ts` —
`SyntaxError: Named export 'BrowserWindow' not found`, originating in
`tear-off-window.ts:3`). That one failure is expected. Leave it alone.

So the done condition is: **221 + your new tests all passing, and still exactly
one failing file, still that same one.** If a second file starts failing, you
broke something — fix it before moving on.

## The micro-task cycle — every task, no exceptions

```
PLAN → IMPLEMENT → VERIFY → REVIEW → COMMIT → GATE → LOG
```

- **PLAN** — write `plans/TASK-ADAM-N.N.md` (what, why, test, risks) BEFORE any
  code. **Note the `ADAM-` namespace.** The un-namespaced names
  `plans/TASK-1.1.md` … `plans/TASK-4.3.md` ALREADY EXIST in this repo from the
  2026-06 dashboard build, each with its own `-REVIEW.md`. Writing to those names
  would overwrite committed design docs from another build, and would make the
  gate vacuous — it checks the plan and review files for existence, and they are
  already there. Seven of this build's eight task numbers collide, so always
  write `TASK-ADAM-N.N.md`.
- **IMPLEMENT** — match surrounding patterns. No speculative abstractions.
- **VERIFY** — both typechecks exit 0, the scoped vitest command above is green
  against the baseline, `npx oxlint` clean on every file you touched.
- **WIRING CHECK** — nothing in this build can be functionally tested here: every
  feature needs a live mic and an ElevenLabs call, so unit tests cannot catch a
  channel typo or a tool-name mismatch. After any task that adds an IPC channel
  or a tool name, run `pnpm run build:electron-vite` and grep `out/` for each new
  channel string and each new tool name. A name that does not appear in the
  bundle is a wiring bug that would otherwise reach Carson.
- **REVIEW** — re-read every changed file, write
  `plans/TASK-ADAM-N.N-REVIEW.md`, fix at least one thing you find.
- **COMMIT** — `git add` specific files, message references the task number.
- **GATE** — `bash scripts/verify-adam-task.sh N.N` must exit 0. **Use this
  script, not `scripts/verify-task.sh`.** The old one targets the 2026-06 app at
  the repo root: it runs `npx vite build` there (so it reports success even when
  `dobius/` is broken), and it fails permanently on a pre-existing
  `// eslint-disable` in the old root `src/` that this build may not touch.
- **LOG** — append to `BUILD-LOG.md`, update `HANDOFF.md`.

## Tasks

### TASK-ADAM-1.1 — Shell tool: classification and gate
`dobius/src/main/jarvis/shell-tool.ts`: classify a command as read-only, denied,
or writing. Pure functions, no execution yet.

**Execution model is `execFile` with an argv array — never `sh -c`, never
`exec`, never `shell: true`.** Copy the shape of `runCli` in
`agent-context.ts:78`. This is the whole reason the classifier can stay small:
with no shell, `>`, `>>`, `|`, `;`, `&&` and `$(...)` are inert literal
arguments, not operators. Do not write a shell-string parser to defend against
them; make them harmless by construction and add one test proving a command
containing `> /tmp/pwned` creates no file.

Read-only allowlist, by leading binary: `ls, cat, head, tail, wc, df, du, ps,
vm_stat, sw_vers, uptime, date, echo, which, pgrep, grep, find, networksetup,
system_profiler`.

**`osascript` is NOT read-only.** The plan says "osascript (get only)" — that is
not decidable by inspecting the argv, and
`osascript -e 'do shell script "..." with administrator privileges'` is a root
escalation. It goes in the writing bucket, always.

Argument scan on top of the allowlist — these force the writing bucket even
though the leading binary is allowed: `find` with `-delete`, `-exec`,
`-execdir`, `-ok`, `-fprint`, or `-fls`; anything invoking `xargs`; `tail`,
`grep` or `cat` with an output-file flag.

Hard deny, never runnable at any approval level: `sudo, su, dd, mkfs, diskutil,
shutdown, reboot, halt, killall, launchctl, csrutil, spctl, security, chown,
chmod` with `-R` at `/`, and any path resolving inside the plugin directory
(invariant B).

`tail -f` needs no classification rule — the 30s execution timeout in TASK-ADAM-1.2
covers it. Do not add string analysis for it.

Tests: the full classification table; every argument-scan case above; the
`> /tmp/pwned` inertness test; a plugin-directory path in the deny bucket.

### TASK-ADAM-1.2 — Shell tool: execution and window approval
Wire the classifier to execution.

- Read-only: runs immediately, `execFile`, 30s timeout, output capped at 4KB.
- Writing: queued as a pending command with an id, and the review window is
  shown with a command payload. Extend
  `dobius/src/main/window/self-edit-window.ts` (note the path — it is in
  `window/`, not `jarvis/`) with a command payload variant alongside the diff
  variant, and a matching branch in `SelfEditView.tsx`.
- Denied: never queued, never executed, reason returned to the agent.

**Per invariant A:** the only IPC that executes a pending command is called by
the review window's button. Do not add an approve/apply client tool.

Tests: an unapproved command never executes — assert the side effect is absent
(the file it would have created does not exist), not merely that a promise
rejected. A test asserting the renderer `clientTools` map contains no key that
can trigger execution. A test that a denied command is not queued at all.

### TASK-ADAM-1.3 — Shell tool: IPC, preload, tool registration
`jarvis:proposeShell` and `jarvis:runApprovedShell` in `jarvis-ipc.ts`, preload
entries, renderer clientTool for propose only.
Register the ElevenLabs tool via the API — see how `ask_adam` and `run_dobius`
were registered; the tool config shape is `{tool_config: {type: "client",
name, description, expects_response, parameters: <JSON schema object>}}`.
Parameters must be a JSON-Schema object, NOT an array.
Run the WIRING CHECK for both channel names and the tool name.

### TASK-ADAM-2.1 — Model-writable memory
Per plan Phase 2. `dobius/src/main/jarvis/adam-memory.ts` with the six fixed
categories, caps, and eviction. `remember` and `forget` tools. Inject into the
existing contextual update in `agent-context.ts`.
Note `buildAgentContext` already truncates at 8,000 chars and the agent prompt
is ~8,400 chars — add the memory block BEFORE the truncation so a full memory
cannot silently push the terminal context out of the payload.
Tests: round trip, per-value cap, total cap eviction order, forget.

### TASK-ADAM-3.1 — Proactive engine
Per plan Phase 3. `dobius/src/main/jarvis/proactive-watcher.ts`.

The plan's trigger is "a terminal that was active then goes quiet for 30s".
**Silence alone is not evidence a job finished** — an agent waiting at a
permission prompt is quiet, an interactive REPL is quiet, and at app start every
terminal idle since yesterday is quiet. Tighten it to all four gates:

1. The tail contains a completion marker (`error`, `failed`, `exit code`, `✗`,
   `FAIL`, `passed`, `✓`, `built in`, `Done`). No marker → say nothing. This is
   the gate that kills the false positives; do not drop it.
2. Quiet for ≥ 30s.
3. Last activity within the last 10 minutes — a staleness ceiling, so launching
   the app never announces yesterday's terminals.
4. Cooldown of 5 minutes, **global, not per terminal.** Four builds finishing
   together must produce one message, not four.

Speak through `jarvis:speak`.
**Ship the off switch in this task** — Settings toggle, default OFF, quiet
hours. A proactive feature without a mute is a defect.
Tests: outcome classification from sample tails; each of the four gates
independently, with an injected clock (never `Date.now()` in the tested path);
a test that four simultaneous completions yield one utterance.

### TASK-ADAM-4.1 — Plugin loader
Per plan Phase 4. `dobius/src/main/jarvis/plugin-loader.ts`. Read
`userData/adam-plugins/*.mjs`, validate the name against
`^[a-zA-Z_][a-zA-Z0-9_]{0,63}$`, reject duplicates, catch throwing plugins and
report rather than crash. Log every plugin loaded at startup by name and path —
nothing runs silently.
**Invariant B belongs to this task:** add the plugin directory to
`FORBIDDEN_SEGMENTS` in `self-edit.ts` and to the shell tool's deny rules, with
a test in each proving a write into that directory is refused.
Tests: valid plugin, bad name, duplicate name, plugin that throws on import,
plugin that throws inside run(), plus the two write-refusal tests above.

### TASK-ADAM-4.2 — ElevenLabs tool sync
`dobius/src/main/jarvis/elevenlabs-tool-sync.ts`. Diff local plugins against the
agent's registered tools: create new, update changed, delete removed.

**Ownership is decided by a name prefix, not a hardcoded list.** Every
plugin-derived tool is registered as `plugin_<name>`, and the sync may only ever
delete tools whose name starts with `plugin_`. Do not implement this as "protect
these five names" — `agent-context.ts:12-18` documents this exact codebase
getting burned by a hardcoded capability list that drifted in both directions,
and here the failure mode is deleting a working tool.
Tests: create/update/delete diffing against a fake API; a test that a tool named
`ask_adam` survives a sync in which no plugins exist at all.

### TASK-ADAM-4.3 — Generic plugin dispatch
Renderer `clientTools` routes any unrecognised tool name to `plugin:run` in
main. Run the WIRING CHECK: the built bundle must still contain every
hand-written tool name.

## Definition of done

Append `BUILD COMPLETE` to `HANDOFF.md` only when ALL of:

- Every task above has `plans/TASK-ADAM-N.N.md` and
  `plans/TASK-ADAM-N.N-REVIEW.md`.
- Both typechecks exit 0.
- `npx vitest run src/main/jarvis src/main/window
  src/renderer/src/components/jarvis` shows **at least 221 passing plus your new
  tests, and exactly one failing file — `attach-main-window-services.test.ts`.**
- `npx oxlint` clean on every touched file.
- The WIRING CHECK passes for every new IPC channel and tool name.
- `rm -rf out dist && pnpm run build:relay && pnpm run build:cli && pnpm run
  build:electron-vite && pnpm run build:web` exits 0.
- `git status --porcelain` is empty.
- `BUILD-LOG.md` has an entry per task.
- Invariants A and B each have a passing test.

Then write, as the last lines of `HANDOFF.md`:

```
BUILD COMPLETE
Carson must: install manually, THEN grant Accessibility + Screen Recording to
"Dobius+ Computer Use". Installing after granting voids the grant.
```
