# REPAIR BUILD-014B — route remaining userData callers through getUserDataRoot (#53 residual)

## Root cause
BUILD-014 added `storage/user-data-root.ts` (`captureUserDataRoot()` first-wins, captured in
index.ts via `persistence.initDataPath()` after `configureDevUserDataPath` and before
`app.setName`) and routed persistence, the eight BUILD-009 stores and runtime-environments through
it. 53 other main-process modules (89 call sites, plus the guarded one in local-pty-shell-ready.ts) still re-read `app.getPath('userData')` on every
access. If Electron's live resolution moves after `app.setName(...)`, those modules would read and
write a different folder than the captured root, splitting data (bug #53 residual).

## Where each module resolves today (packaged app) — nothing moves
- Chromium resolves and caches `DIR_USER_DATA` from package.json `name` (`dobius-plus`) before
  `app.setName('Dobius+')` runs (index.ts:1643), so on macOS a late lazy call returns the same
  `dobius-plus` directory as the captured root.
- Evidence from `ls` (names only) of `~/Library/Application Support/dobius-plus/`: files that only
  late (post-setName) lazy callers write are all there: `orchestration.db` (dobius-runtime.ts),
  `relay.db` (relay-lifecycle.ts), `speech-models`, `workstation-media`, `self-edit-backups`
  (jarvis-ipc.ts), `voice-conductor-cli-token`, `imessage-bridge.json`, `vertex-tasks.json`,
  `serve-sim-runtime`, `codex-runtime-home`, `claude-runtime-auth`.
- `~/Library/Application Support/Dobius+/` holds exactly one entry: `dobius-runtime.json`, a
  symlink to `…/dobius-plus/dobius-runtime.json` (dated Aug 29; not written by any code path found). No module holds real
  data there, so no migration is needed (no STOP condition).
- Pre-capture callers are unaffected: before capture `getUserDataRoot()` returns the live path
  uncached, byte-for-byte what `app.getPath('userData')` returned. These are
  `configureDobiusUserDataPathEnv()` (index.ts:431, sets `DOBIUS_USER_DATA_PATH` for CLI children)
  and the `browserSessionRegistry` singleton constructor (browser-session-registry.ts:665,
  module-import time). All other routed sites run after `initDataPath()`.
- Dev: `configureDevUserDataPath` sets an explicit `Dobius+-dev` (or E2E / override) path, which
  setName does not change, so dev is unchanged too.

## Fix
Mechanical: in 53 files, `app.getPath('userData')` → `getUserDataRoot()` (same subpaths and file
names), import added, `app` import removed where it became unused (plus a now-dead
`require('electron')` in `dobius-runtime.ts getOrchestrationDb`).
`providers/local-pty-shell-ready.ts` keeps its pre-existing no-`app` guard (it used
`app?.getPath?.(…)`): `app ? getUserDataRoot() : undefined`, then the existing
`DOBIUS_USER_DATA_PATH` / tmpdir fallbacks. Its importers are all main-process (local-pty-provider,
ipc/pty); the guard only matters for non-Electron loads such as tests.

### Allowlisted exceptions (left calling Electron directly)
- `storage/user-data-root.ts:14,25,37` — the capture, the pre-capture fallback, the divergence check.
- `index.ts:444` — pre-lock startup diagnostic; logs Electron's live value (logging only, pre-capture).
- `index.ts:2116` — `migrateMobilePairingDataToCanonicalUserDataPath(app.getPath('userData'))`:
  deliberately reads the *late* live path as the copy-if-missing source (BUILD-014 left it too).

### dobius-runtime.json (cross-process file) — path logic untouched
- Writer: `runtime/runtime-rpc.ts:1102` `writeRuntimeMetadata(this.userDataPath, …)`, where
  `userDataPath = getCanonicalUserDataPath()` (index.ts:2123) = captured root. Cleared by
  `clearRuntimeMetadataIfOwned` (index.ts) with the same path. Not changed by this build.
- Readers: `src/cli/runtime/metadata.ts` (`DOBIUS_USER_DATA_PATH`, else hard-coded
  `…/Application Support/dobius-plus`, `%APPDATA%/dobius-plus`, `$XDG_CONFIG_HOME/dobius-plus`),
  `src/relay/remote-cli-env.ts` (forwards `DOBIUS_USER_DATA_PATH`), `config/scripts/*.mjs` dev
  helpers, `mobile/scripts/start-emulator-pairing-runtime.mjs`. None edited. Voice-conductor CLI
  scripts do not read it (they read `voice-conductor-cli-token`, whose writer and scripts both use
  `conductorCliServerAddress()`, so they move together).
- `DOBIUS_USER_DATA_PATH` is still set pre-capture (same value as before). `CliInstaller`'s default
  `userDataPath` (feeds the dev launcher's `DOBIUS_USER_DATA_PATH`) now equals the writer's path by
  construction instead of by coincidence.

## Tests
`src/main/storage/user-data-root-callers.test.ts` (8 tests):
- Guard: scans every non-test source file in `src/main`, strips comments, counts
  `getPath('userData')` shapes (`app.getPath`, `app?.getPath?.`, any quote style) and requires the
  result to equal the allowlist exactly (per-file counts, so a new call in index.ts also fails).
  Plus a scanner self-test for the call shapes and for comments being ignored.
- Behavior: capture `dobius-plus`, flip the live path to `Dobius+`, then assert routed callers stay
  in the captured root: claude managed accounts, workstation repos, scrcpy jar, voice-conductor CLI
  token, prompts store write (nothing lands in the late dir), `DOBIUS_USER_DATA_PATH`.

Mutation checks (each failed, then restored):
- M1 prompts-store back to `app.getPath('userData')` → guard + prompts write test fail (2).
- M2 voice-conductor/cli-install back → guard + token test fail (2).
- M3 configure-process back → guard + env test fail (2).
- M4 managed-auth-path back → guard + accounts test fail (2).
- M5 extra `app.getPath('userData')` appended to index.ts → guard fails (1).

## Verification
- `pnpm run typecheck` exit 0.
- Targeted vitest: 124 files (co-located tests of every changed module + every src/main test that
  mentions userData + the new test): 3131 passed, 37 failed in `cli/cli-installer.test.ts` (4) and
  `ipc/pty.test.ts` (33). Both files are in `basefail.txt`; with this build's edits to
  `cli-installer.ts` and `pty.ts` reverted the same 37 fail, so they are pre-existing.
- oxlint: clean except pre-existing `max-lines` in `dobius-cli/dispatch-server.ts` (370-line file
  before this build; one added import line). react-doctor config clean.
- Full suite: DEFERRED (coordinator).

## Deviations
- Touches 54 source files (the brief expected this; runs alone).
- `local-pty-shell-ready.ts` keeps its original no-`app` fallback, with a `// Why:` comment.
- `dispatch-server.ts` max-lines left (needs a file split; out of scope).

## Rollback
Revert the commit. No on-disk format or location changes; resolved directories are identical.

## Lessons
- `getUserDataRoot()` is a safe drop-in even pre-capture because its fallback is uncached; the
  guard test now makes any new direct `getPath('userData')` in src/main an explicit allowlist edit.
