# Dobius+ — Autonomous Build: Adam control, memory, proactive, plugins

You are building four features on branch `feat/adam-voice-control` in the
worktree `/Users/bayou/Projects (Code)/dobius-adam`. The full design is in
`plans/TASK-ADAM-CONTROL.md` — READ IT FIRST, it is the specification.

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
6. Read `LESSONS-LEARNED.md` before the first task and obey every entry.
7. If verification fails twice on the same task, append the failure pattern to
   `LESSONS-LEARNED.md` before continuing.

## Environment notes that will bite you

- The app source is in `dobius/`. Run all pnpm commands from there.
- `pgrep`/`pkill` patterns must escape the plus: `Dobius\+`. An unescaped
  `Dobius+` means "Dobiu followed by one or more s" and never matches.
- zsh does not word-split unquoted variables. `for f in $FILES` passes the
  whole list as one argument. Use `while IFS= read -r`.
- Paths contain spaces and parentheses. Always quote them.
- `pnpm run build:unpack` fails if `out/` is stale — `rm -rf out dist` first.
- Typecheck is `npx tsgo --noEmit -p config/tsconfig.node.json` and
  `-p config/tsconfig.tc.web.json`. Both must exit 0.
- Lint is `npx oxlint <paths>`. It uses `oxlint-disable`, not `eslint-disable`.
  Never disable `max-lines` — split the file instead.
- Do not add a `no-control-regex` suppression; build the pattern with
  `String.fromCharCode` instead (see `terminal-history-context.ts`).

## The micro-task cycle — every task, no exceptions

```
PLAN → IMPLEMENT → VERIFY → REVIEW → COMMIT → GATE → LOG
```

- **PLAN** — write `plans/TASK-N.N.md` (what, why, test, risks) BEFORE any code.
- **IMPLEMENT** — match surrounding patterns. No speculative abstractions.
- **VERIFY** — both typechecks exit 0, `npx vitest run <touched dirs>` green,
  `npx oxlint` clean on every file you touched.
- **REVIEW** — re-read every changed file, write `plans/TASK-N.N-REVIEW.md`,
  fix at least one thing you find.
- **COMMIT** — `git add` specific files, message references the task number.
- **GATE** — `bash scripts/verify-task.sh N.N` must exit 0.
- **LOG** — append to `BUILD-LOG.md`, update `HANDOFF.md`.

## Tasks

### TASK-1.1 — Shell tool: classification and gate
Per plan Phase 1. `src/main/jarvis/shell-tool.ts`: classify a command as
read-only, denied, or writing. Read-only allowlist and hard denylist are
specified in the plan. Pure functions, no execution yet.
Tests: the full classification table, including commands that LOOK read-only
but are not — `find -delete`, `find -exec`, `osascript` that sets rather than
gets, `tail -f` (never terminates), `grep --include` with a write redirect.
Redirection (`>`, `>>`), pipes into writers, and `$(...)` substitution must all
force the writing bucket regardless of the leading binary.

### TASK-1.2 — Shell tool: execution and approval window
Wire the classifier to execution. Read-only runs immediately with a 30s timeout
and 4KB output cap. Writing commands route to the review window — extend
`self-edit-window.ts` with a command payload variant alongside the diff variant.
Denied commands never reach execution.
Test: an unapproved command never executes (assert the side effect is absent,
not just that the promise rejected).

### TASK-1.3 — Shell tool: IPC, preload, tool registration
`jarvis:runShell` in `jarvis-ipc.ts`, preload entry, renderer clientTool.
Register the ElevenLabs tool via the API — see how `ask_adam` and `run_dobius`
were registered; the tool config shape is `{tool_config: {type: "client",
name, description, expects_response, parameters: <JSON schema object>}}`.
Parameters must be a JSON-Schema object, NOT an array.

### TASK-2.1 — Model-writable memory
Per plan Phase 2. `src/main/jarvis/adam-memory.ts` with the six fixed
categories, caps, and eviction. `remember` and `forget` tools. Inject into the
existing contextual update in `agent-context.ts`.
Tests: round trip, per-value cap, total cap eviction order, forget.

### TASK-3.1 — Proactive engine
Per plan Phase 3. `src/main/jarvis/proactive-watcher.ts`. Watch
`terminal-history/*/output.log` for a terminal that was active then goes quiet;
classify the tail for an outcome; speak through `jarvis:speak`.
Gates: silence threshold, cooldown, and stay silent when nothing is useful.
**Ship the off switch in this task** — Settings toggle, default OFF, quiet
hours. A proactive feature without a mute is a defect.
Tests: outcome classification from sample tails; gate logic with an injected
clock (never `Date.now()` directly in the tested path).

### TASK-4.1 — Plugin loader
Per plan Phase 4. `src/main/jarvis/plugin-loader.ts`. Read
`userData/adam-plugins/*.mjs`, validate the name regex, reject duplicates,
catch throwing plugins and report rather than crash. Log every plugin loaded at
startup by name and path — nothing runs silently.
Tests: valid plugin, bad name, duplicate name, plugin that throws on import,
plugin that throws inside run().

### TASK-4.2 — ElevenLabs tool sync
`src/main/jarvis/elevenlabs-tool-sync.ts`. Diff local plugins against the
agent's registered tools: create new, update changed, delete removed. Never
delete a tool that is not plugin-owned — the hand-registered tools
(`ask_adam`, `get_context`, `run_dobius`, `propose_code_change`,
`apply_code_change`) must survive a sync.
Tests: create/update/delete diffing against a fake API, and a test proving
non-plugin tools are never deleted.

### TASK-4.3 — Generic plugin dispatch
Renderer `clientTools` routes any unrecognised tool name to `plugin:run` in
main. Verify the built bundle still contains the hand-written tools.

## Definition of done

Append `BUILD COMPLETE` to `HANDOFF.md` only when ALL of:

- Every task above has `plans/TASK-N.N.md` and `plans/TASK-N.N-REVIEW.md`.
- Both typechecks exit 0.
- `npx vitest run src/main src/renderer/src/components` fully green, with no
  fewer than the 145 tests that pass today.
- `npx oxlint` clean on every touched file.
- `rm -rf out dist && pnpm run build:relay && pnpm run build:cli && pnpm run
  build:electron-vite && pnpm run build:web` exits 0.
- `git status --porcelain` is empty.
- `BUILD-LOG.md` has an entry per task.

Then write, as the last lines of `HANDOFF.md`:

```
BUILD COMPLETE
Carson must: install manually, THEN grant Accessibility + Screen Recording to
"Dobius+ Computer Use". Installing after granting voids the grant.
```
