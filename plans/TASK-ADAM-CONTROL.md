# Build plan: Adam — control, plugins, proactive, memory

> **REVISED 2026-08-29 after a pressure test.** Several decisions below were
> found defective and are corrected in `AUTONOMOUS-BUILD.md`. Where the two
> documents disagree, **AUTONOMOUS-BUILD.md wins.** The corrections are marked
> inline as `CORRECTION:`. Read this file for the *why*; take the *what* from
> the build file.

Four features, one rebuild at the end. Ordered so each phase is independently
testable and the riskiest thing (shell execution) reuses a gate that already
exists and is tested.

## Ground rules for this build

- **One rebuild, at the end.** Each reinstall re-signs the computer-use helper
  and macOS drops its Accessibility grant. Carson grants permissions AFTER the
  final install, not before.
- Every phase ships with at least one runnable test.
- Nothing that writes to the machine runs without an approval window.

---

## Phase 1 — Shell tool with approval gate

**What:** one `run_shell` tool. Read-only commands run immediately; anything
that writes goes through the review window already built for self-edits.

**Why:** covers the four real gaps `dobius computer` does not — launching apps,
system settings (volume, brightness, wifi), hardware telemetry, file
operations. Mark LI spends ~2,700 lines on these; on macOS each is a one-liner.

**Design:**
- Classify a command as read-only or writing. Read-only allowlist by leading
  binary: `ls, cat, head, tail, df, du, ps, top, vm_stat, sw_vers, system_profiler,
  pgrep, grep, find, which, echo, date, uptime, networksetup -getinfo, osascript
  (get only)`.
- Hard deny regardless of approval: `sudo, rm -rf /, dd, mkfs, diskutil erase,
  shutdown, reboot, killall Finder, chmod -R /, :(){`.
- Everything else = "writing" → reuse `SelfEditStore`'s window pattern with a
  command payload instead of a diff.
- Timeout 30s, output capped at 4KB, no shell interpolation of user text.

**CORRECTION (approval is not actually human).** The self-edit flow this reuses
does not have the property claimed here. `apply_code_change` is exposed as a
client tool (`use-voice-agent.ts:115`) alongside the window's own button
(`SelfEditView.tsx:105`), so the model can approve its own write. Acceptable for
a reversible diff; not for a shell command. The shell tool must expose NO
approve tool — execution is reachable only from the window's button.

**CORRECTION (classify argv, not a shell string).** Use `execFile` with an argv
array as `runCli` already does (`agent-context.ts:78`). With no shell, `>`, `|`,
`;` and `$(...)` are inert literals, and the whole category of redirection
parsing disappears rather than needing defences.

**CORRECTION (`osascript` is not read-only).** "get only" is not decidable from
the argv, and `osascript -e 'do shell script ... with administrator privileges'`
escalates to root. It belongs in the writing bucket unconditionally.

**Files:** `src/main/jarvis/shell-tool.ts` (new), `self-edit-window.ts` (reuse,
add a command payload variant), `jarvis-ipc.ts`, `use-voice-agent.ts`,
ElevenLabs tool registration.

**Test:** classification table — read-only passes, denied list refused,
unknown command routed to approval. One test that an unapproved command never
executes.

**Risk:** voice mishearing turning into an executed command. Mitigated by the
approval window for every write and the hard denylist above it.

**Estimate:** ~200 lines, 1 build.

---

## Phase 2 — Model-writable memory (`remember`)

**What:** a `remember(category, key, value)` tool Adam calls himself, persisted
locally and injected into every call's context.

**Why:** he currently gets the last 3 conversation summaries and nothing he
chose to keep. Mark LI's version is the right shape and is ~270 lines.

**Design:**
- Categories fixed, copied from Mark LI: `identity, preferences, projects,
  relationships, wishes, notes`.
- Store at `userData/adam-memory.json`. Cap 380 chars per value, ~2,200 total,
  oldest notes evicted first.
- Returns silently (Mark LI's `silent: true` pattern) so saving does not
  interrupt speech.
- Injected into the existing contextual update at connect.
- A `forget(key)` tool, because auto-remembered wrong facts are worse than no
  memory — he told Carson the disk was 98% full when it was 91%.

**Files:** `src/main/jarvis/adam-memory.ts` (new), `agent-context.ts`,
`jarvis-ipc.ts`, `use-voice-agent.ts`, tool registration.

**Test:** write/read round trip, cap enforcement, eviction order, forget.

**Estimate:** ~150 lines, same build.

---

## Phase 3 — Proactive engine

**What:** Adam speaks unprompted when something real happens — a build fails, a
long job finishes, an agent goes quiet.

**Why:** this is the feature that changes what he is. Mark LI's version guesses
from time-of-day because it has no signals; Dobius+ has real ones.

**Design:**
- Watch `terminal-history/*/output.log` (already the source for recent-activity
  context). A terminal that was active and goes quiet for 30s is a finished job.

**CORRECTION (silence is not completion).** An agent waiting at a permission
prompt is quiet; an interactive REPL is quiet; at app start every terminal idle
since yesterday is quiet. Require a completion marker in the tail IN ADDITION to
the silence, add a 10-minute staleness ceiling, and make the cooldown global so
four builds finishing together produce one message rather than four.
- Scan its tail for outcome markers: `error, failed, exit code, ✗, FAIL,
  passed, ✓, built in, Done`.
- Gates copied from Mark LI (`actions/proactive.py`): minimum silence before
  speaking, cooldown between messages, and "say nothing if nothing is useful".
  Tighter numbers than theirs — 30s silence, 5 min cooldown — because our
  trigger is an event, not a guess.
- Speak through `jarvis:speak` (plain ElevenLabs TTS, cheap) rather than opening
  an agent call, which bills by the minute.
- **Off switch required:** a Settings toggle, default OFF, plus quiet hours.

**Files:** `src/main/jarvis/proactive-watcher.ts` (new), `jarvis-ipc.ts`,
`JarvisSettingsSection.tsx`, `speech-types.ts`.

**Test:** outcome classification from sample log tails; cooldown and
silence-gate logic with an injected clock.

**Risk:** an assistant that talks at you unprompted is intolerable if it is
wrong or too frequent. Default off, cooldown, quiet hours, one-line mute.

**Estimate:** ~250 lines, same build.

---

## Phase 4 — Plugin system

**What:** drop one file in a folder, Adam gains a tool. No rebuild.

**Why:** the biggest multiplier in Mark LI. Every capability tonight cost a
local handler + an ElevenLabs tool registration + a renderer change + a rebuild,
about fifteen times over.

**Design:**
- Plugins live in `userData/adam-plugins/*.mjs`, each exporting:
  ```js
  export const PLUGIN = { name, description, parameters }  // JSON schema
  export async function run(parameters) { return 'spoken result' }
  ```
- On startup: read the folder, validate names against
  `^[a-zA-Z_][a-zA-Z0-9_]{0,63}$`, reject duplicates, catch bad files and report
  them rather than crashing (Mark LI's loader does exactly this).
- **Sync to ElevenLabs:** for each valid plugin, create or update the matching
  agent tool via the API and attach it. Remove tools whose plugin disappeared.
  This is the part Mark LI does not need and we do, because our tools live
  server-side.
- Dispatch: the renderer's `clientTools` gets a generic handler that routes any
  unknown tool name to `plugin:run` in main.

**Files:** `src/main/jarvis/plugin-loader.ts` (new),
`src/main/jarvis/elevenlabs-tool-sync.ts` (new), `jarvis-ipc.ts`,
`use-voice-agent.ts`.

**Test:** loader validation (good file, bad name, duplicate, throwing plugin),
and sync diffing (create, update, delete) against a fake API.

**RESOLVED (was an open question).** Plugins are unsigned code executing in the
main process, so the userData folder is only safe if Adam cannot write to it.
Phase 1 gives him a shell tool with an approval window — which means one approved
innocuous-looking write into the plugin folder becomes permanent, unapproved code
execution on every launch. Neither phase is dangerous alone; together they are a
privilege-escalation path.

Keep the userData folder, and add it to the forbidden paths of both the self-edit
resolver and the shell tool, with a test on each. Carson installs plugins by hand.
Keep the startup log line naming every plugin loaded.

**Estimate:** ~350 lines, same build.

---

## Sequence

1. Phase 1 (shell + gate) — highest immediate value, reuses tested gate.
2. Phase 2 (memory) — small, and Phase 3 reads from it.
3. Phase 3 (proactive) — needs the off switch shipped with it.
4. Phase 4 (plugins) — largest, and the one that makes future phases unnecessary.
5. Single build, single install.
6. **Then** Carson grants Accessibility + Screen Recording to "Dobius+ Computer
   Use". Not before — the install re-signs the helper and voids the grant.
7. Verify: `dobius computer get-app-state --app "Dobius+"` returns a tree.

## Done bar

**CORRECTION — the original bar below was unachievable and is superseded by the
one in `AUTONOMOUS-BUILD.md`.** Two errors: the repo has 566 pre-existing test
failures across 542 files on this branch's base commit, so "all green" over a
broad scope cannot be reached; and "nothing committed" is stale — the work is now
on a clean worktree where every task commits.

Use the scoped gate instead: `npx vitest run src/main/jarvis src/main/window
src/renderer/src/components/jarvis` → 221 passing on the clean branch plus new
tests, with exactly one expected failing file
(`attach-main-window-services.test.ts`).

- `pnpm typecheck` clean for main and renderer.
- `oxlint` clean on every touched file.
- Every new IPC channel and tool name verified present in the built bundle.
- Installed asar inode matches the running process (Carson's step, after the
  single manual install).
