# REPAIR BUILD-020 — temp-file hygiene (#49 #51) · Upstream

## Root cause
- #49 `stats/collector.ts` `writeToDiskSync()` wrote `<file>.<pid>.<ms>.<rand>.tmp` then renamed
  with no try/catch at all: any write or rename failure left the temp on disk (the 0-byte
  residue seen in the audit).
- #49 `agent-hooks/server.ts` `runStatusPersist()` only unlinked the temp when `tmpWritten`
  was true. `writeFileSync` that throws midway (ENOSPC, EIO) has already created the temp,
  so a partial write leaked it. (Corrects ARCHITECTURE-MAP Appendix A, as the spec notes.)
- #51 `browser/browser-session-registry.ts` `persistMeta()` used one fixed temp name
  `browser-session-meta.json.tmp` for every save and swallowed every error in an empty catch,
  so a failed save left the shared temp behind and nothing reported the failure.
- No writer ever removed residue left by an earlier crash.

## Fix
- `storage/safe-json-file.ts` (BUILD-009 shared helper):
  - `writeFileAtomic(target, text)` — unique `<file>.<pid>.<12 hex>.tmp` + rename; the temp is
    removed on ANY failure (write or rename). `writeJsonFileAtomic` now delegates to it
    (same bytes and naming as before).
  - `removeTempFile(tmp)` — unlink, ENOENT ignored, anything else warned; never throws.
  - `sweepStaleTempFiles(dir, pattern, minAgeMs = 10 min)` — removes only files matching the
    writer's own name pattern, older than 10 minutes, and whose pid (regex group 1) is not
    another live process (`kill(pid, 0)`; EPERM counts as alive). All writers are synchronous
    and finish in milliseconds, so 10 minutes can only be crash/failure residue.
- stats collector: writes through `writeFileAtomic` (compact JSON kept); constructor sweeps
  `dobius-stats.json.<pid>.….tmp` (matches both the old and new name, so existing residue on
  Carson's disk is cleaned).
- agent-hooks: temp removed unconditionally on failure via `removeTempFile`; `start()` sweeps
  `.last-status-<pid>-<uuid>.tmp` in the endpoint dir. Temp naming and 0o600 mode unchanged.
- browser-session-registry: `persistMeta()` uses `writeJsonFileAtomic` (unique temp, cleanup)
  and `console.error`s the failure instead of an empty catch. Startup
  (`initializeBrowserSessionsFromPersistedState`) sweeps new-format temps and the legacy shared
  `browser-session-meta.json.tmp` (no owner pid, so age-only).
- "Serialize updates" (#51 matrix text): `persistMeta` is a synchronous read-modify-write on the
  main thread, so in-process saves cannot interleave; the real hazard was the shared temp name,
  now unique per save.

## Tests
- `src/main/storage/temp-file-hygiene.test.ts` (new, pass-through `node:fs` mock with injected
  failures on real temp dirs): partial write (ENOSPC after bytes written) and rename failure →
  primary intact, no temp; sweep removes own/dead-pid old temps, keeps another live pid's old
  temp, keeps a young temp, ignores non-matching names, missing dir is a no-op.
- `src/main/stats/collector.test.ts` (new): partial write / rename failure during `flush()` keep
  the previous stats file and leave no temp; constructor sweep removes old-format own-pid and
  dead-pid residue, keeps live-pid and young temps and unrelated files.
- `src/main/agent-hooks/server-temp-files.test.ts` (new): real server + hook POST; partial write
  and rename failure keep previous `last-status.json`, no temp; `start()` sweep keeps live/young.
- `src/main/browser/browser-session-registry.persistence.test.ts` (extended; fs mock gained
  `readdirSync`/`statSync`/failure flags): each save uses its own temp name (never the legacy
  shared name); partial write / rename failure keep metadata bytes, no temp, error reported;
  startup sweep removes legacy + dead-pid temps, keeps live-pid and young ones.

## Mutation checks (each made tests fail, then restored)
- M0 all three writers reverted to HEAD (new tests kept): 9 fail — stats write/rename/sweep,
  browser unique-name/write/rename/sweep, agent-hooks partial-write/sweep. (agent-hooks
  rename-failure case passes on HEAD too: the old gate already covered it; kept as regression.)
  All pre-existing registry persistence tests still pass on HEAD.
- M1 agent-hooks skips cleanup on ENOSPC (old `tmpWritten` behaviour): partial-write test fails.
- M4 sweep ignores pid liveness: 4 live-writer tests fail (storage, stats, agent-hooks, browser).
- M5 sweep ignores minimum age: 4 young-temp tests fail.
- M6 `writeFileAtomic` without `removeTempFile`: both storage cleanup tests fail.

## Verification
- `pnpm run typecheck` exit 0.
- Targeted: 14 files / 371 tests green (storage/*, stats/*, agent-hooks server + server-temp-files,
  browser-session-registry{,.persistence}, browser-session-startup, webview-hardening,
  dobius-runtime-browser, star-nag).
- oxlint + react-doctor clean on all 8 changed files. oxfmt clean on new files; the one oxfmt
  complaint in the persistence test is two pre-existing lines, left untouched.
- Full suite: DEFERRED to coordinator.

## Deviations from EXECUTION-ORDER.md
- Touched `src/main/storage/safe-json-file.ts` (not in the file list): the cleanup/sweep logic
  lives once in the BUILD-009 shared helper instead of three copies. `writeJsonFileAtomic`
  behaviour is unchanged.
- agent-hooks keeps its own inline write (0o600 mode, dot-prefixed temp name) to keep the
  Upstream diff small; only the cleanup gate changed plus the start-up sweep.
- Not addressed (outside #51): `loadPersistedMeta()` still treats an unreadable
  `browser-session-meta.json` as empty, so the next save overwrites it with defaults. Adopting
  `SafeJsonFile` there changes every caller and the many tests that mock this module's fs;
  it belongs with the safe-persistence stores work.

## Rollback
Revert the commit. Temps written by the new code use the same naming family, so old code simply
ignores them; nothing on disk needs migrating.

## Lessons
- Load average ~128 during this run: the first test of a file that dynamically imports the
  registry hit the 30 s timeout once and passed on re-run alone. Re-run before suspecting code.
