# REPAIR BUILD-014 — one userData root (#53)

## Root cause
Two notions of "the userData directory" coexisted:
- **Cached:** `persistence.ts` `initDataPath()` captured `app.getPath('userData')` once (index.ts,
  after `configureDevUserDataPath`, before `app.setName`) into `_userDataDir` / `_dataFile`;
  `getCanonicalUserDataPath()` returned it, but its fallback cached whatever the live path was on
  first call (so a pre-init call could pin a pre-redirect path).
- **Lazy:** every other store re-read `app.getPath('userData')` on each access — the eight BUILD-009
  stores, `ipc/runtime-environments.ts:47`, and in `index.ts` the agent-hook server (x2), the
  Windows ACL grant, the GPU fallback marker (read + write) and `selfHealRuntimeEnvironmentFocus`
  (the last runs right after `app.setName`).

If Electron's live resolution changes after `app.setName` (the code's own comment says it can on
case-sensitive filesystems), the two groups land in different directories and data splits.

## Which directory everything resolves to today (from code, not Carson's files)
- Packaged: package.json `name` = `dobius-plus`, no `productName` in package.json
  (`productName: 'Dobius+'` lives only in `config/electron-builder.config.cjs`). Userdata =
  `<appData>/dobius-plus`. `app.setName('Dobius+')` (index.ts, inside whenReady) runs after Chromium
  has already resolved and cached `DIR_USER_DATA`; repo CLAUDE.md records the same ("setName runs
  after userData is cached so it does NOT change this path"), and ARCHITECTURE-MAP 2.2 lists the
  lazy stores' files (`agents-runs.json`, `agents.json`, …) inside `dobius-plus/`. So on macOS the
  cached and lazy roots are the same directory today.
- Dev: `configureDevUserDataPath` → `app.setPath('userData', <appData>/Dobius+-dev)` (explicit
  override, stable across setName). `DOBIUS_DEV_USER_DATA_PATH` / E2E `userDataDir` are also
  explicit `setPath` overrides.
- `ls ~/Library/Application Support/` (names only): `dobius-dev`, `dobius-plus`, `Dobius+`,
  `Dobius+-dev`. Contents not read.

## Fix
- New `src/main/storage/user-data-root.ts`: `captureUserDataRoot()` (first capture wins),
  `getUserDataRoot()` (captured root; before capture it follows the live path **without caching**),
  `reportUserDataRootDivergence()` (logs once if the live path no longer matches the captured root,
  keeps the captured root, leaves the other directory untouched; returns it).
- `persistence.ts`: `initDataPath()` → `captureUserDataRoot()`; `getDataFile()` and
  `getCanonicalUserDataPath()` read `getUserDataRoot()`. Hunks limited to 307-327 and 434-445
  (away from BUILD-013 recovery code). `app` import dropped (now unused).
- BUILD-009 stores (agents-store, agent-runs-store, agent-notification-store, agent-briefing-store,
  agent-draft-store, asana-dispatch-ledger, asana/asana-config, communications/team-store):
  `app.getPath('userData')` → `getUserDataRoot()`. Same file names.
- `ipc/runtime-environments.ts` `getUserDataPath()` → `getUserDataRoot()`.
- `index.ts`: the six post-init lazy calls above → `getCanonicalUserDataPath()`;
  `reportUserDataRootDivergence()` right after `app.setName`. Untouched: the pre-lock startup
  diagnostic (logging only) and `migrateMobilePairingDataToCanonicalUserDataPath(app.getPath(...))`
  at ~2090 (intentional "late" source for the existing copy-if-missing bridge; BUILD-003 area).

Resolved directory for the packaged app is unchanged (`dobius-plus`), dev unchanged
(`Dobius+-dev`), so nothing moves on Carson's next launch. No data is moved, copied or deleted.

## Tests
`src/main/storage/user-data-root.test.ts` — three profile fixtures (packaged `dobius-plus`→`Dobius+`,
dev `Dobius+-dev`→`Dobius+: <branch>`, remote/e2e override → `Dobius+`), each: capture via
`persistence.initDataPath()`, flip the live path, assert root/canonical path stable, second capture
does not move it, divergence reported once; each of the 8 stores writes its file under the captured
root and nothing in the late dir; `runtimeEnvironments:list` IPC reads the captured root. Plus
pre-capture: follows live path without pinning; no warning when paths match. 32 tests.

Mutation checks (each made the suite fail, then restored):
- M1 `getUserDataRoot` ignores the capture → 30 fail.
- M2 agents-store back to `app.getPath('userData')` → 3 fail.
- M3 runtime-environments back to `app.getPath('userData')` → 3 fail.
- M4 capture overwrites instead of first-wins → 3 fail.
- M5 pre-capture fallback caches → 2 fail.
- M6 `getCanonicalUserDataPath` reads live path → 3 fail.

## Verification
- Targeted: storage/, agents/, asana/, team-store, ipc/runtime-environments,
  runtime/mobile-pairing-userdata-path, persistence, automations/ → 29 files / 578 tests green.
- Typecheck / lint: see return block.
- Full suite: DEFERRED (coordinator).

## Deviations from EXECUTION-ORDER.md
- Added `src/main/storage/user-data-root.ts` (new file) so the stores do not import the 3.7k-line
  `persistence.ts`; `getCanonicalUserDataPath()` stays as the public name and delegates to it.
- Edited the 8 BUILD-009 store files (brief asked for it; resolved dir unchanged).
- index.ts: switched four more lazy call sites than the spec's line list (hook server x2, ACL,
  GPU marker x2, self-heal), all after `initDataPath`.
- Not changed (reported): the ~100 other lazy `app.getPath('userData')` calls in other modules, and
  `agents/agent-run-event-journal.ts` (post-ready lazy root; pre-ready `~/.dobius`). On macOS they
  resolve to the same directory; unifying them touches files owned by other builds.

## Rollback
Revert the commit. No on-disk format or location changes.

## Lessons
- Any store that writes under userData should import `getUserDataRoot()` from
  `storage/user-data-root.ts`, never `app.getPath('userData')`.
