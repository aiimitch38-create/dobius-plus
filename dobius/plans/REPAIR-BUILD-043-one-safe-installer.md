# REPAIR BUILD-043 — One safe installer (#100 #103 #104 #105 #112)

## Root cause
Three install entry points with different guarantees:
- `build-and-install.sh:41` exec'd `scripts/install-dobius-v2.sh`, which ran
  `rm -rf "$INSTALLED"` (:73) and only then `ditto` (:78). A failed copy left no app (#100).
  It wrote no provenance, took no lock and had no downgrade guard, so the next gated install's
  ownership check saw no owner (#103).
- `scripts/install-dobius-gated.sh` ran the ownership + downgrade checks (:27-61) BEFORE
  `mkdir "$LOCK"` (:64), so a queued install judged stale state; then `rm -rf "$DEST"; mv "$STAGE" "$DEST"`
  (:93-94) left a window with no app, and a failed `mv` left none at all (#104).
- The gated script copied the build and left `dobius/dist/mac-arm64/Dobius+.app` (same bundle ID)
  on disk → duplicate-Dock-icon risk (#105).
- The install-gate hook (`~/.claude/hooks/dobius-install-gate.sh:19-20`) only sees the literal
  app path in the typed command; the two ungated scripts carried the path inside the file, so
  `./build-and-install.sh` walked around it (#112).

## Fix
- `scripts/install-dobius-gated.sh` — order is now: resolve paths → **lock first** (mkdir, waits up
  to `DOBIUS_INSTALL_LOCK_WAIT`=300 s so concurrent installers serialize; pid written for
  diagnosis; stale locks are reported, never auto-broken) → ownership check → downgrade guard →
  fresh stage copy (`rm -rf` stage, `cp -R`) → provenance stamp (unchanged format) →
  **validate the stage** (Info.plist CFBundleExecutable + CFBundleIdentifier, executable present,
  `app.asar` present, binary arch runs on host, provenance JSON parses) → quit app (graceful, then
  `pkill -a -x "Dobius\+"` + `pkill -f "Dobius\+ Helper.*--type="`, never the daemon) → **atomic swap**
  (`renamex_np(RENAME_SWAP)` via python3 ctypes; plain rename on first install) → old bundle moved
  to ONE rollback copy `~/Library/Application Support/dobius-plus-install-backups/Dobius+.previous`
  (no `.app` suffix so LaunchServices never registers it; previous rollback deleted first so the
  disk never holds two) → remove the source bundle when it lives under a `dist/` folder (#105; a
  bundle elsewhere is only warned about) → lsregister + relaunch → history log (now also records
  the rollback path).
- EXIT trap: while holding the lock, removes whatever is at the stage path (partial new bundle, or
  the old bundle if the rollback move failed) and the lock. Any failure before the swap exits
  6 (copy) / 7 (validation) / 8 (swap) with the installed app untouched.
- Test overrides: `DOBIUS_INSTALL_DEST`, `DOBIUS_INSTALL_LOCK`, `DOBIUS_INSTALL_LOCK_WAIT`,
  `DOBIUS_INSTALL_BACKUP_DIR`, `DOBIUS_INSTALL_HISTORY_LOG`. The app is quit/killed/relaunched and
  LaunchServices touched **only** when the destination is exactly `/Applications/Dobius+.app`, so
  a test can never touch the running app.
- Found while testing: on a first install PlistBuddy prints `File Doesn't Exist, Will Create: <path>`
  to stdout, and the downgrade guard compared the digits in that path as a version (refused a
  first install into any path with digits). Version reads are now guarded by `[ -f plist ]`.
  The compare itself (`-rc` handling, #102) is untouched — that is BUILD-044.
- `build-and-install.sh`, `scripts/install-dobius-v2.sh` → retired pointers: print the build +
  gated-install commands to stderr and `exit 1`. No `rm`, copy, kill or build left in them (#100,
  #103, #112 — the only script that writes the app is the gated one, which the hook allows by name).
- Kept from NOTES.md: provenance stamp, branch take-over guard, lock, staged swap, install history,
  daemon-safe pkill patterns with escaped `+` (now with `-a` for the main app, see review round 1). "rm -rf the old bundle before copying" is preserved
  in substance: the stage is always a fresh tree and the old bundle is replaced whole by the swap
  (test asserts no file from the old bundle survives).

## Tests
`dobius/config/scripts/install-dobius-gated.test.mjs` (repo's `.test.mjs` script-test pattern).
Every run: fixture root under `os.tmpdir()`, `HOME` set to the fixture, `DOBIUS_INSTALL_DEST`
asserted to be inside the fixture. Fixture bundles use a real Mach-O (`/bin/echo`) so the arch
check runs, and a fixture bundle ID.
1. Happy path: v1→v2 swap, stale v1 file gone, provenance stamped, ONE rollback (`Dobius+.previous`
   = v1), no stage left, dist source removed (#105), lock released, history line. Second install
   v3: still ONE rollback, now v2.
2. First install with no prior app; a source outside `dist/` is not deleted.
3. Copy failure (unreadable file in source) → exit 6, prior bundle intact, no stage/lock/backup.
4. Validation failure (no `app.asar`) → exit 7, prior bundle intact.
5. Rename failure (`chflags uchg` on the installed bundle) → exit 8, prior bundle intact.
6. Lock first (#104): lock held + provenance owned by another branch → exit 4 (lock), not 3.
7. Concurrency: two installers in parallel with a slow `cp` shim on PATH → both exit 0, copy trace
   is start,end,start,end (never interleaved), one rollback, two history lines.
8. Retired scripts: static check (no rm/cp/mv/ditto/rsync/pkill/osascript/open/exec/pnpm/
   electron-builder outside comments/echo; `exit 1`; points at the gated script) and execution
   (exit 1 + pointer text). Execution is refused by the test itself if the static check fails, so
   an un-retired script is never run.

Mutation checks: see "Verification".

## Review round 1 (coordinator findings F1-F3)
- F1: macOS `pgrep`/`pkill` exclude their own ancestors unless `-a`. An install run from a
  Dobius+ terminal descends from the main app (main `Dobius+` pid → detached daemon
  `Dobius+ Helper … daemon-entry.js` → login → zsh → claude → zsh), so the wait loop never saw the
  app and `pkill -x` skipped it. Now `pgrep -a -f …` and `pkill -a -x "Dobius\+"`. The helper kill
  stays `pkill -f "Dobius\+ Helper.*--type="`: the daemon is forked at
  `src/main/daemon/daemon-init.ts:295` with args `daemon-entry.js --socket <p> --token <p>` (no
  `--type=`), and its process name is `Dobius+ Helper`, never an exact `Dobius+`. Confirmed live
  (`ps`): daemon pid 979 has its own process group (pgid 979) and is `detached: true` +
  `child.unref()` (`daemon-init.ts:302,372`), so killing the main app reparents it to launchd and
  neither it nor the installer's shell (its descendant) is signalled.
- F2: `MANAGE_APP` is now decided on the resolved DEST, compared case-insensitively with the
  resolved real destination, so `/Applications//Dobius+.app` and `/applications/Dobius+.app/`
  manage the app (checked with the same expression in a standalone bash snippet; not unit-testable
  without the real path).
- F3: quit/kill moved to after the stage copy + validation, just before the swap. A failed build
  (exit 6/7) never closes the app. If the swap fails after quitting, the unchanged app is relaunched
  (`open -a`) before exit 8.
- Test-only env: `DOBIUS_INSTALL_TEST_MANAGE_APP=1` forces the app steps for a fixture DEST, and
  `DOBIUS_INSTALL_LSREGISTER` points at a shim. Tests put recorder shims for
  osascript/pgrep/pkill/open first on PATH and assert: order validate → quit → pgrep -a → pkill -a -x
  → helper pkill → swap → lsregister → open (new app); no quit on validation failure; relaunch of the
  old app on swap failure.
- Mutations (app-management tests fail, then restored): N1 `pkill` without -a; N2 `pgrep` without
  -a; N3 quit moved back before the stage copy; N4 no relaunch after swap failure.

## Rollback
Revert the commit: the old gated script and the two old entry points come back from git. The
rollback bundle dir `~/Library/Application Support/dobius-plus-install-backups/` is inert (delete
by hand if unwanted). To go back one install: `scripts/install-dobius-gated.sh
"$HOME/Library/Application Support/dobius-plus-install-backups/Dobius+.previous" --take-over`
(printed by the script after every install).

## Deviations from EXECUTION-ORDER.md
- `~/.claude/hooks/dobius-install-gate.sh` NOT edited (external; spec says only with Carson's OK).
  #112 is closed in-repo by removing every ungated write path; the hook stays advisory.
- Dropped from the retired v2 script, not ported: the source-staleness check (`ALLOW_STALE`) and
  clearing Electron render caches in the live userData dir. The gated installer never had them;
  it takes any built bundle (possibly from another worktree), so "newer source files" has no single
  source tree to compare against. Arch + `app.asar` checks were ported (into stage validation).
- ADAM's required `app.asar.unpacked/out/cli/index.js` is NOT validated: that is #101's build-graph
  fix; checking it here would refuse today's `build:electron-vite`-only builds before #101 lands.
- Downgrade-guard plist read guarded (pre-existing bug found by the fixture test, see Fix).
- Root/`.claude` CLAUDE.md still describe `./build-and-install.sh` (bug #116, a different build).

## Lessons
- The global install-gate hook matches any command text containing `Applications/Dobius+` plus
  `rm`/`cp` — including fixture paths like `tmp/Applications/Dobius+.app`. Name scratch fixtures
  differently when testing by hand.
- Node `spawn` with piped-but-unread stdout never emits `close`; ignore stdout or use `exit`.

## Verification
- Targeted: `config/scripts/install-dobius-gated.test.mjs` 14/14 green after review round 1 (11/11 before) (~50 s on the loaded machine).
- Mutation checks (each made the file fail, then restored; logs in `stabilize-run/043/mut-*.log`):
  M1 lock moved after the checks → lock-first test fails (exit 3). M1b no lock → lock-first +
  concurrency tests fail. M2 swap failure ignored → rename test fails. M3 no stage cleanup on exit →
  copy/validation/rename tests fail. M4 no `app.asar` check → validation test fails. M5 dist copy
  kept → happy-path test fails. M6 previous rollback not dropped → happy-path test fails (two
  copies). M7 plist `-f` guard removed → first-install test fails (exit 5). M9 pre-BUILD-043
  `build-and-install.sh` + `install-dobius-v2.sh` restored from git → all 4 retired-script tests
  fail and the test refused to execute them.
- `pnpm run typecheck` exit 0. oxlint + react-doctor config: 0 warnings / 0 errors on the test file
  (the shell scripts are not oxlint targets; `bash -n` clean; shellcheck not installed).
- Full suite: DEFERRED (coordinator).
