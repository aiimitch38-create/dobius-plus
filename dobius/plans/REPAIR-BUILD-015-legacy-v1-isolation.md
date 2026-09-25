# REPAIR BUILD-015 — legacy V1 isolation (#52)

## Root cause
The legacy V1 app (repo-root `electron/`, package name `dobius-plus`) and V2 (`dobius/`, package
name `dobius-plus`) resolve the same userData dir (`<appData>/dobius-plus`, see BUILD-014 plan).
V1 writes there with no notion of ownership:
- `electron/config-manager.js:6-11`: `CONFIG_DIR = app.getPath('userData')`, `config.json`
  (which also holds checkpoints: `electron/main.js` `checkpoint:save/delete/rename` →
  `setProjectConfig`) and `terminal-history/<b64>/<tab>.scrollback.json`.
- Chromium itself writes its profile files (Local State, Local Storage, caches) into userData at
  startup, so a V1 launch touches V2's Chromium profile too.

V2 had no marker saying "this dir is V2's", so nothing could stop a V1 launch (or a V1 already
running) from writing into V2-owned data. V2's side reads V1's `config.json` once
(`migrate-legacy-dobius-config.ts`) and never writes it, but it resolved the path through the lazy
`app.getPath('userData')` (:46) instead of the BUILD-014 captured root.

Checked, not a V2→V1 clobber: V2 terminal-history GC (`terminal-history.ts` `gcScanRoot`) skips
dirs without `meta.json`, and the retention sweep (`daemon/history-retention.ts`) only removes dirs
with V2 session metadata. V1's `<b64>/` dirs have neither, so V2 never deletes them.

## Fix
- **V2 writer marker** — new `src/main/storage/v2-writer-marker.ts`: `claimV2WriterMarker(version,
  root = getUserDataRoot())` writes `dobius-v2-writer.json` (`{writer, claimedAt, appVersion}`) via
  BUILD-009 `writeJsonFileAtomic`; never overwrites an existing marker; a write failure is logged
  and not fatal (V2 data is still fine; only the V1 lock-out is missing).
- `index.ts`: call it right after `initDataPath()`, inside the single-instance-lock branch, so it
  lands before other writers and a transient second process never writes.
- `migrate-legacy-dobius-config.ts:46`: `app.getPath('userData')` → `getUserDataRoot()`.
- **V1 guard** — new `electron/v2-writer-guard.js` (same marker name):
  - `hasV2WriterMarker(dir)`: `lstat`; ENOENT → absent, any other error → present (fail closed).
  - At import time: if the marker exists in the shared dir, `v1RefusedAtStartup = true` and
    `app.setPath('userData', <temp>/dobius-v1-refused)` so Chromium's startup writes and every
    later path resolution land outside V2's dir.
  - `v1WritesBlocked()`: refused at startup OR marker present now (V2 claimed the dir while V1 was
    already running). Logs once.
- `electron/main.js`: guard imported first among local modules; `whenReady` starts with
  "if refused → `dialog.showErrorBox` + `app.exit(0)`", before any handler/window/writer.
  `app.exit` skips `before-quit`, so the config flush never runs.
- `electron/config-manager.js`: `v1WritesBlocked()` checked in `atomicWrite` (async config save),
  `atomicWriteSync` (quit flush + load-time save; throws, callers already catch and warn),
  `saveTerminalScrollback`, and `migrateScrollbackOutOfConfig` (which writes per-tab files).

## Tests
`src/main/storage/legacy-v1-isolation.test.mjs` (`.mjs`: V1 is plain JS outside the TS project;
imports the real V1 modules by absolute path with a mocked `electron`). 7 tests:
1. V1 and V2 use the same marker file name.
2. V2 launch (claim + migration) against a dir seeded with V1 `config.json` + scrollback: every V1
   file byte- and mtime-identical; marker created; second launch returns `present`, marker unchanged.
3. V1 launched after V2: refused, userData redirected, a full V1 session (load with inline
   scrollback, checkpoint write, debounced async save, scrollback save, quit flush) leaves the
   shared dir identical and writes no files in the redirect dir.
4. V1 already running: writes work before V2 (control), then after V2 claims the dir the same
   session writes nothing.
5. V1 `main.js`: guard is the first local import; refusal + `app.exit(0)` come before
   `setupCrashLogging()` in `whenReady`.
6. V2 migration reads V1's config from the captured root after the live path moves; nothing lands
   in the late dir.
7. Marker check fails closed on a non-ENOENT error.

Mutation checks (each made the suite fail, then restored):
- M1 guard never refuses at startup → 1 fail. M2 no userData redirect → 1 fail.
- M3 async `atomicWrite` unguarded → 2 fail. M4 `atomicWriteSync` unguarded → 2 fail.
- M5 `saveTerminalScrollback` unguarded → 2 fail. M6 load-time scrollback migration unguarded → 1
  fail (first attempt passed because the fixture's tab was pruned as orphaned; fixture now lists
  the tab). M7 marker check fails open → 1 fail. M8 V2 claim overwrites marker → 1 fail.
- M9 running V1 checks only startup state → 1 fail. M10 migration back to `app.getPath` → 1 fail.
- M11 guard import removed from the top of main.js → 1 fail. M12 `app.exit` after setup → 1 fail.

## Verification
- `pnpm run typecheck` exit 0.
- Targeted: `src/main/storage` + `migrate-legacy-dobius-config.test.ts` → all green.
- Lint: dobius files clean (both configs). V1 files are outside the dobius lint scope; linting
  them with `dobius/.oxlintrc.json` shows only pre-existing errors (74 in config-manager.js, 150 in
  main.js, mostly `curly`), none on the lines this build added; the new V1 file is clean.
- Full suite: DEFERRED (coordinator).

## Deviations from EXECUTION-ORDER.md
- Spec anchor `migrate-legacy-dobius-config.ts:122-128` now points at the allowedProjects import;
  nothing there writes V1 files. The one change in that file is :46 (captured root).
- `electron/main.js:376` is the checkpoint IPC; checkpoints persist through `config.json`, so they
  are covered by the config-manager guards rather than a change at :376.
- New files: `electron/v2-writer-guard.js`, `dobius/src/main/storage/v2-writer-marker.ts`, and a
  2-line call in `dobius/src/main/index.ts` (outside the spec's file list; needed so V2 writes the
  marker on every launch, not only when a V1 config exists).
- Pre-existing lint errors in the legacy V1 files left as is (would rewrite hundreds of untouched
  legacy lines).
- Not guarded individually (covered by the startup refusal, not by a mid-run check): V1
  `crash.log`, `voice-bridge-token`, zsh `HISTFILE` dirs, and Chromium profile writes of a V1
  process that was already running when V2 first claimed the dir.

## Decisions for Carson
- The refusal dialog tells the user they can run the legacy app anyway by quitting Dobius+ and
  deleting `dobius-v2-writer.json`. Remove that sentence if the escape hatch is unwanted.

## Rollback
Revert the commit. The marker file is inert for code without this build: old V2 and old V1 ignore
it. No data is moved, copied or deleted.

## Lessons
- ESM evaluates imports in order, so a guard module that must act before other modules resolve
  paths has to be the first local import.
- vitest resolves a relative dynamic import outside the project root against the root; use an
  absolute path from `import.meta.url`.
