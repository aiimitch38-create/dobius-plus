# HANDOFF — Dobius+

Last updated: 2026-10-27

## Handoff — 2026-10-27: bug-fix sweep (fix everything below, in order)

Found via a 3-agent bug hunt (Kanban/task-pipeline read by hand + two subagents over electron/ and src/) on branch `aiimitch38-create/UI-UPDATES`, HEAD `72f76915`. Full architecture context in `IRIS-REPORT-20261027.md`. Work on a new branch off this one; do NOT touch unrelated files. Build (`npm run build`) must exit 0 and the relevant feature must be manually re-tested before each commit — this app has no automated test suite to catch these.

### 1. HIGH — tear-off dock destroys a sibling browser tab
**File:** `src/components/Project/TerminalTabBar.jsx:286-315` (`afterDocked`)
**Bug:** When a torn-off tab docks back into the main window, `afterDocked` closes the tear-off window once zero `kind:'terminal'` tabs remain — it never checks for a `kind:'browser'` tab still open in that window, so it gets destroyed with no save/restore.
**Fix:** Count ALL tabs (`t.kind === 'terminal' || t.kind === 'browser'`, or just `tabs.length`), not just terminal-kind, before calling `window.close()`.
**Test:** Tear off a window with 1 terminal + 1 browser tab. Drag the terminal tab back to the main window. The tear-off window must stay open with the browser tab intact.

### 2. MEDIUM — checkpoint IPC handlers not project-gated
**File:** `electron/main.js:693-730` (`checkpoint:save`, `checkpoint:list`, `checkpoint:delete`, `checkpoint:rename`)
**Bug:** Unlike `git:*`, `files:*`, `visual:*`, these handlers trust the renderer-supplied `projectPath` with no `isKnownProject` check — any window can read/write/delete another project's checkpoint (saved terminal scrollback).
**Fix:** Add the same `if (!(await isKnownProject(projectPath))) return { ok:false, error:'projectPath is not a known project root' };` guard used at `visual:start` (~line 1148) to all four handlers.
**Test:** From one project window, call `checkpoint:list` with a different, valid project's path — must be rejected once the guard is in.

### 3. MEDIUM — Tasks panel can desync from Kanban pipeline stage
**File:** `src/components/shared/TasksDropdown.jsx:87-96` (`handleToggle`)
**Bug:** The check-done path calls `tasksComplete` but never updates the locally cached task's `stage` to `'done'` afterward. If the user unchecks the box before the `tasks:updated` broadcast reloads, `isPipelineDone` reads the stale pre-complete `stage`, takes the raw `tasksUpdate({done:false})` path instead of `tasksReopen`, and the backend `stage` stays stuck at `'done'` while `done:false` is shown — board and panel disagree.
**Fix:** After a successful `tasksComplete` call, optimistically set the cached task's `stage` to `'done'` locally too (or just force a `loadTasks`/refetch synchronously before allowing another toggle on the same task).
**Test:** Check a task done, immediately uncheck it (within ~1s), then open the Kanban board — the task must show in `approval`, not stuck in `done`.

### 4. MEDIUM — Search results race (stale response overwrites newer one)
**File:** `src/components/Dashboard/Search.jsx:38-68` (`handleInput`)
**Bug:** The debounce only cancels the pending *timer*, not an in-flight `dataSearchTranscripts` call. Typing a second query before the first search resolves can let the slower first response land after the second and overwrite its results.
**Fix:** Tag each search call with a request id (or `AbortController`) and ignore any response that isn't for the latest request.
**Test:** Type a query, wait ~500ms so the search fires, then quickly clear and type a different query before the first finishes — results shown must match the box's current text.

### 5. MEDIUM — filewatcher IPC handlers inconsistently gated
**File:** `electron/main.js:674-686` (`filewatcher:unwatch`, `filewatcher:getEvents`)
**Bug:** `filewatcher:watch` is gated with `isKnownProject`; `unwatch`/`getEvents` are not. Inconsistent — a renderer can unwatch/read events for a path it never opened.
**Fix:** Add the same gate to both handlers.
**Test:** n/a security hardening — verify normal watch/unwatch still works after the change.

### 6. LOW — Costs tab crashes on missing projectName
**File:** `src/components/Dashboard/Costs.jsx:77`
**Bug:** Sorting by "Name" calls `.localeCompare` directly on `a.projectName`/`b.projectName` with no guard; any entry with an undefined `projectName` (a transcript dir that failed to decode) throws and blanks the whole tab.
**Fix:** `(a.projectName || '').localeCompare(b.projectName || '')`.
**Test:** n/a unless a repro file with a bad project name is available; low-risk guard, ship it.

### 7. LOW — Kanban preview fallback is dead code
**File:** `src/components/Dashboard/Kanban/KanbanView.jsx:68`
**Bug:** `const live = typeof loadTasks === 'function'` is always true (store always defines it), so `PREVIEW_SEED`/`previewLegal` and the "preview data" banner can never run.
**Fix:** Delete the `live` branch and the preview fallback entirely (`PREVIEW_SEED`, `previewLegal`, the `!live` banner, lines ~22-44 and ~70, ~106-137, ~170-174) — simplify `moveTask`/render to the live-only path.
**Test:** Kanban board still loads and drag/drop still works against the real store.

### 8. LOW — Kanban drag-over highlight can get stuck
**File:** `src/components/Dashboard/Kanban/KanbanView.jsx` (`dragOver` state, `onDragOverCol`/`onDragLeaveCol`)
**Bug:** `dragOver` only clears via `dragleave`/`drop`. Dragging a card off the window and releasing outside any column leaves a column's border highlighted.
**Fix:** Add a `dragend` handler on the dragged card (or a window-level `dragend`/`drop` listener) that clears `dragOver` unconditionally.
**Test:** Start dragging a card, release the mouse outside the board entirely — no column should stay highlighted.

### 9. LOW — git-service relative-path trap
**File:** `electron/git-service.js:14-19` (`validateDir`)
**Bug:** Compares `path.resolve(dir)` (always absolute) against `path.normalize(dir)` (preserves relative input unchanged) — a relative `projectDir` would silently report `{isRepo:false}` instead of resolving it. Not triggered today (every current caller passes an absolute path) but a latent trap for the next caller that doesn't.
**Fix:** Resolve both sides the same way (`path.resolve(dir) === path.resolve(gitRoot)` or similar), or document that `projectDir` must always be absolute and assert it.
**Test:** n/a today; just close the trap.

### 10. LOW — voice-bridge /stage route has no project allowlist
**File:** `electron/voice-bridge.js:210-237` (`handleStage`)
**Bug:** Gated by localhost + bearer token (not attacker-reachable without the token), but accepts any `projectPath` string with no `isKnownProject`-style check, unlike the IPC convention elsewhere.
**Fix:** Add the same allowlist check before resolving/advancing a task.
**Test:** n/a security hardening.

**Suggested order:** 1 (user-visible data loss) → 2 → 5 (security gates, same pattern, do together) → 3 → 4 → 6 → 9 → 10 → 7 → 8 (cleanup/cosmetic last).

Per the Done Bar: each fix needs `npm run build` exit 0, a manual re-test per the "Test" line above, then commit referencing this section before moving to the next item.

---

Last updated: 2026-06-21

## Current state (the one thing that matters)
All fixes are **committed in source at v1.0.24**. They are **NOT installed** — the app in `/Applications` is still **v1.0.22** (predates the fixes). Only remaining action: **build + install v1.0.24** (`./build-and-install.sh`).

| | Version | Has crash fixes? |
|---|---|---|
| Source / git HEAD | v1.0.24 | YES (committed in `d24dc58 v1.0.23: four critical fixes`, then 8 rounds of Claude+Codex review) |
| Installed app | v1.0.22 | NO |

## The three bugs (fixes committed)
1. **Blank terminals / can't start or resume Claude** — node-pty `spawn-helper` lost its execute bit in the v1.0.22 build (electron-builder asar-unpack drops +x; scp/rsync/chmod could too). Fixed by: `ensureSpawnHelperExecutable()` startup self-heal + `build/after-pack.cjs` afterPack hook (restores +x at build time).
2. **Clicking Dashboard crashed the app (main-process OOM, SIGTRAP)** — `DashboardView` mount -> `loadAllSessions()` read + fully JSON-parsed the ENTIRE `~/.claude` history (927MB / 6,773 files) at once. Fixed by: `parseJsonl` tail-read (`readTail()`, bounded) + `mapLimit(..., 24)` bounded pool in `loadAllSessions`.
3. (Lower priority, NOT addressed) older SIGABRT = node-pty aborting during app quit.

## What's done (committed + verified)
- `electron/data-utils.js` — `parseJsonl` tail-read when `limit > 0` (`readTail()`, 64KB backward chunks, 4MB cap) + `mapLimit(items, limit, fn)`. Verified: identical last-5/last-100 vs old, +0MB vs +95MB on a 24MB file.
- `electron/data-service.js` — `loadAllSessions` uses `mapLimit(..., 24, ...)` instead of unbounded nested `Promise.all`.
- `electron/terminal-manager.js` — `ensureSpawnHelperExecutable()` startup self-heal.
- `electron/main.js` — calls it first in `whenReady`; `setupCrashLogging()` -> `userData/crash.log`.
- `build/after-pack.cjs` + `electron-builder.yml` (`afterPack: build/after-pack.cjs`) — restores spawn-helper +x at build, before signing.
- `LESSONS-LEARNED.md` — Build + Performance lessons.

## Build Passes: YES

---

## Handoff update — 2026-06-13 (scaffolding)

**Done:**
- `.claude/CLAUDE.md` (Claude workflow layer) in place.
- `.claude/settings.json` created with scoped permissions: allows `dev`, `build`, `build:mobile`, `electron:dev`, `start`, read-only git (`status`, `diff`, `log`), and `npx electron-rebuild`. Denies `npm run electron:build` (signed/notarized release — human-only) and `./build-and-install.sh` (rm -rf + install to /Applications — human-only).
- Scaffolding files (LESSONS-LEARNED.md, BUILD-LOG.md, HANDOFF.md) updated with a dated section each.

**In progress:**
- ~27 uncommitted files — the in-flight dashboard feature. Untracked: `electron/file-change-service.js`, `src/components/Dashboard/{ChangeFeed,Costs,Prompts,Search}.jsx`, `src/components/Launcher/ProjectContextMenu.jsx`. Plus 21 modified (Dashboard views, store.js, electron data/preload/window/voice services, several launcher/project/shared components, AUTONOMOUS-BUILD.md, package-lock.json).
- Branch: `feature/multi-account-cli-path`, last commit `d082675`.

**Next:**
- Review and branch the in-flight dashboard work deliberately before starting new builds. Do not blow it away; confirm intent before committing or branching over it.

**Known issues / cautions:**
- See `LESSONS-LEARNED.md` (incl. the 2026-06-13 audit section) for runtime/build gotchas: null bytes in `execFile`, dev process name `"Electron"`, `build-and-install.sh` rm -rf, mounted-tab requirement, native-module rebuild, remote-debugging-port pre-ship check, config.json not hand-editable.
- `npm run electron:build` and `./build-and-install.sh` are human-initiated only and are denied in `.claude/settings.json`.

---

## What's next (in order)
1. **Build + install v1.0.24**: `./build-and-install.sh`. This installs the fixes over the old 1.0.22 and bakes in the afterPack +x. A clean rebuild also drops the leftover `app.asar.unpacked.bak-precompletedfix/` junk shipped in the current bundle.
2. **Ship-test after install**: open the Dashboard with the full 927MB history present, confirm no crash + sessions list populates. Confirm a fresh terminal tab + `claude --resume` works.
3. Done — v1.0.24 already committed; just needs the build.

## State of the running app right now
- Terminals work (installed v1.0.22 spawn-helper is executable; the 06-12 chmod held).
- Dashboard OOM fix is NOT live yet (installed app is pre-fix). Avoid opening the Dashboard until v1.0.24 is built + installed.

## Note
- Sam's buddy SSH'd into the box pulling files; code signature verified intact (no corruption), nothing world-writable. Audit that script if/when available.
