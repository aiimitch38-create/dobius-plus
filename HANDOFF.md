# HANDOFF — Adam control build

Last updated: 2026-08-29 (build start)

> The previous contents of this file described the June v1.0.22 crash fixes and
> were two months stale. Recoverable from git history if needed.

## Current state

Autonomous build in progress on branch `feat/adam-voice-control`, worktree
`/Users/bayou/Projects (Code)/dobius-adam`.

Specification: `AUTONOMOUS-BUILD.md` (authoritative) and
`plans/TASK-ADAM-CONTROL.md` (design rationale). Both were revised on
2026-08-29 after a pressure test; where they disagree, the build file wins.

**Starting point:** commit `640e064d`, tree clean, build green (exit 0),
scoped test baseline 221 passing.

## If you are a resumed agent, read this before anything else

1. Re-read `AUTONOMOUS-BUILD.md` in full. Your context was lost; its hard rules
   and the two security invariants are not optional.
2. **The repo has 566 pre-existing test failures across 542 files.** They fail
   on this branch's base commit and are unrelated to this work. Do NOT fix them.
   Your only test gate is:
   `npx vitest run --config config/vitest.config.ts src/main/jarvis src/main/window src/renderer/src/components/jarvis`
   → 221 baseline + your new tests, with exactly one expected failing file
   (`attach-main-window-services.test.ts`). The `--config` is REQUIRED — see below.
3. Never touch `/Users/bayou/Projects (Code)/Dobius/dobius-plus` — another
   agent has uncommitted work there.
4. Check `git log --oneline` to see which tasks already committed, and resume
   from the first one that has not.

## Task status

| Task | State |
|---|---|
| TASK-ADAM-1.1 shell classification | **DONE** — committed, gate passed |
| TASK-ADAM-1.2 shell execution + window approval | **DONE** — committed, gate passed |
| TASK-ADAM-1.3 shell IPC + tool registration | **DONE** — committed, gate passed |
| TASK-ADAM-2.1 model-writable memory | **DONE** — committed, gate passed |
| TASK-ADAM-3.1 proactive engine | **DONE** — committed, gate passed |
| TASK-ADAM-4.1 plugin loader | **DONE** — committed, gate passed |
| TASK-ADAM-4.2 ElevenLabs tool sync | not started |
| TASK-ADAM-4.3 generic plugin dispatch | not started |

## TASK-ADAM-1.1 — complete

Committed with its plan (`plans/TASK-ADAM-1.1.md`) and review
(`plans/TASK-ADAM-1.1-REVIEW.md`). `bash scripts/verify-adam-task.sh 1.1` exits 0.

Scoped test count is now **318 passing**, still exactly one failing file
(`attach-main-window-services.test.ts`). Use 318 as the floor from here.

**The gate command changed.** Always pass `--config config/vitest.config.ts`:

```
npx vitest run --config config/vitest.config.ts src/main/jarvis src/main/window src/renderer/src/components/jarvis
```

There is no `vitest.config.ts` at `dobius/` root, so the bare command the build
file originally prescribed ran with Vitest defaults — a 5s `testTimeout` instead
of the project's 30s — and `src/main/window` flaked roughly 1 run in 6 with
extra "failing" files that were only slow dynamic imports. `AUTONOMOUS-BUILD.md`
and `scripts/verify-adam-task.sh` are both fixed. If you see a second failing
file, check you used `--config` before suspecting your own change.

## TASK-ADAM-2.1 — complete

Committed with its plan and review. Scoped test count is now **343 passing**,
still exactly one failing file (`attach-main-window-services.test.ts`). **Use
343 as the floor from here.**

What exists: `adam-memory.ts` (`AdamMemory` class — `remember`, `forget`,
`list`, `format`; six fixed categories; `MAX_KEY_CHARS` 80, `MAX_VALUE_CHARS`
380, `MAX_TOTAL_CHARS` 2,200; JSON at `userData/adam-memory.json`),
`jarvis:remember` / `jarvis:forget` IPC + preload, `remember` / `forget` client
tools, and `REMEMBER_TOOL` / `FORGET_TOOL` registered through the same
`ensureClientTool` path as `propose_shell`.

**Two things a later task must not undo:**

1. **`composeAgentContext(memoryBlock, machineState)` in `agent-context.ts` owns
   the 8,000-char budget split.** Memory is capped at `MAX_MEMORY_CHARS` (half
   the budget) and only the machine state is truncated. Do not "simplify" this
   back to one `.slice()` over a joined string — that is how a full memory
   silently evicts the terminal context, and it was measured happening (payload
   10,048 chars, machine state gone).
2. **`evict(protectedKey)` must keep skipping the entry just written.** Without
   it a new fact can select itself as its own eviction victim while `remember`
   still returns `ok` and the IPC still says "Saved."

**Registration is a sequential loop** over `[PROPOSE_SHELL_TOOL, REMEMBER_TOOL,
FORGET_TOOL]` in `ensureAgentToolsRegistered`. TASK-ADAM-4.2 will add more tools
— keep it sequential. Each `ensureClientTool` reads and PATCHes the agent's
`tool_ids`, so a `Promise.all` races and the loser's tool is dropped from a list
it never saw.

## Phase 1 is complete — what exists now

The whole shell path is built and gated. `TASK-ADAM-3.1` (proactive engine) is
next.

- `shell-tool.ts` — `classifyShellCommand(argv, options)`, pure. `ClassifyOptions`
  takes `pluginDir` and an injectable `realpath`. `adamPluginDir(userData)` is the
  ONE definition of the plugin folder — **TASK-ADAM-4.1 must import it**, not
  re-join the path, or invariant B's deny rules and the loader drift apart.
- `shell-command-store.ts` — classify, run read-only, queue writing, refuse denied.
- `elevenlabs-tools.ts` — `ensureClientTool` and friends; TASK-ADAM-4.2's sync
  should build on these rather than re-writing the API layer.
- `voice-agent-client-tools.ts` — the renderer tool map, now importable and
  covered by the invariant-A test. **TASK-ADAM-4.3 adds generic plugin dispatch
  here; that test must still pass afterwards.**

**Unverified, for Carson:** the ElevenLabs endpoint shapes in `elevenlabs-tools.ts`
are implemented to the shape `AUTONOMOUS-BUILD.md` specifies and tested against a
fake `fetch` — no billed calls were made against your account. At first launch
with a key configured, check the main-process log for
`[jarvis] tool propose_shell id=… created=… attached=…`, or a
`[jarvis] could not register propose_shell: …` warning. Attaching PATCHes your
live agent; it round-trips your existing prompt block so a replace-semantics API
cannot drop your system prompt, but the first run is worth watching.

`classifyShellCommand(argv, options)` in `dobius/src/main/jarvis/shell-tool.ts`
is the gate TASK-ADAM-1.2 wires to execution. It is pure — it does not run
anything. `ClassifyOptions` takes `pluginDir` (invariant B) and an injectable
`realpath`.

**Carried into TASK-ADAM-1.3:** the classifier does not guard against non-string
argv elements on purpose. `jarvis:proposeShell` MUST coerce every element with
`String(...)` at the IPC boundary, the way `jarvis:proposeSelfEdit` already does.

**Noted, out of scope (do not fix):** the existing self-edit flow lets the model
approve its own write — `apply_code_change` is exposed as a client tool at
`use-voice-agent.ts:115` and reaches the same `jarvis:applySelfEdit` IPC as the
window's button at `SelfEditView.tsx:105`. Tolerable for a reversible on-screen
diff with a backup; the shell tool must NOT copy it (invariant A).

## TASK-ADAM-3.1 — complete

Scoped test count is now **382 passing**, still exactly one failing file. **Use
382 as the floor from here.**

`proactive-watcher.ts` splits into a pure `decideProactive(input)` holding all
four gates and a thin `ProactiveWatcher` shell that polls every 15s. Two things
a later task must not undo:

1. **`classifyOutcome` strips paths before scanning for markers.** Without it,
   `error` matches inside a FILENAME and a passing run is announced as a
   failure — measured on a green vitest tail and a clean vite build. Word
   boundaries do not help; `-` is already one.
2. **The watcher primes on its first tick.** Otherwise opening the app announces
   a job that finished minutes before launch.

Settings are `jarvisProactive` (default OFF), `jarvisProactiveQuietFrom` /
`jarvisProactiveQuietTo`. All optional, read with `=== true`, so no
config-manager change is needed.

## TASK-ADAM-4.1 — complete

Scoped test count is now **399 passing**, still exactly one failing file. **Use
399 as the floor from here.**

**Invariant B is now closed on both sides and both are tested** — the shell half
in `shell-tool.test.ts` ("the plugin directory (invariant B)") from 1.1, the
self-edit half in `plugin-loader.test.ts` ("INVARIANT B") from 4.1. Do not
remove either, and do not add a second literal spelling of `adam-plugins`:
`ADAM_PLUGINS_DIR_NAME` in `shell-tool.ts` is the one definition and both
consumers import it.

What 4.2 and 4.3 need from `plugin-loader.ts`:

- `getLoadedPlugins()` in `jarvis-ipc.ts` is the list, populated at startup.
  **If 4.2 and 4.3 do not both use it, delete it** — it exists only for them.
- `pluginToolName(name)` → `plugin_<name>`, and `PLUGIN_TOOL_PREFIX`. **4.2 must
  decide tool ownership by this prefix, never by a hardcoded name list** — the
  build file is explicit, and the failure mode is deleting a working tool.
- `runPlugin(plugin, parameters)` already catches a throwing plugin and returns
  text, so 4.3's dispatch does not need its own try/catch.

**Re-run the WIRING CHECK for `plugin_` in 4.2/4.3.** It is absent from the
bundle today because `pluginToolName` is unreferenced and gets tree-shaken; it
must reappear once those tasks call it.

Verified, not assumed: the CommonJS bundle preserves the loader's dynamic
`import()` un-rewritten, so `.mjs` plugins really do load in the packaged app.

## Tasks 1.1 – 4.1 are committed and independently verified

Do not redo them. `TASK-ADAM-4.2` (ElevenLabs tool sync) is next, then 4.3.

Note for the record: the supervisor was killed mid-2.1 at 07:29 by an external
process reaper, not by a failure of the work. The task was resumed from disk and
carried through VERIFY → REVIEW → COMMIT → GATE → LOG.

## For Carson, when this finishes

Install manually, THEN grant Accessibility + Screen Recording to
"Dobius+ Computer Use". Installing after granting voids the grant.
