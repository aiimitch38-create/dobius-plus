# Build plan: Adam — control, plugins, proactive, memory

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

**Open question for Carson:** plugins are unsigned code executing in the main
process. Folder-in-userData means no rebuild but anything that writes there can
run code as the app. Alternative is plugins in the repo, which is safe but needs
a rebuild. Recommend starting with the userData folder and a startup log line
naming every plugin loaded, so nothing runs silently.

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

- `pnpm typecheck` clean for main and renderer (excluding the pre-existing
  computer-use-lane errors in `communications/providers`).
- `oxlint` clean on every touched file.
- All new tests green; existing 88 voice tests still green.
- Installed asar inode matches the running process.
- Nothing committed — the tree still carries another lane's work.
