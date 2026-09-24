# REPAIR BUILD-021 — daemon history integrity and retention (#50 #48) · Upstream

## Root cause
- **#50** `HistoryManager.openSession()` (was history-manager.ts:85) and `updateMeta()` (was :383,
  used by `closeSession()` and `dispose()`) wrote `meta.json` in place with `writeFileSync`. A crash
  or full disk mid-write leaves a truncated file. Every reader (`HistoryManager.readMeta`,
  `HistoryReader.readMeta`/`hasRestorableHistory`/`detectColdRestore`) then gets `null`: the
  terminal loses its identity (cwd, dims) and its cold-restore eligibility, while `hasHistory()`
  (existsSync only) still says the session exists.
- **#48** Nothing ever deletes daemon session dirs under `userData/terminal-history/` except the
  explicit user-close path (`DaemonPtyAdapter.shutdown` → `removeSession`). The worktree GC in
  `src/main/terminal-history.ts` (`gcScanRoot`) scans the same root but skips any meta without
  `worktreeId`, which is every daemon session. Ended sessions accumulate forever.

## Fix
- `history-manager.ts`
  - `openSession` and `updateMeta` publish meta.json with BUILD-009 `writeJsonFileAtomic`
    (unique tmp + rename; tmp removed on failure). An interrupted update leaves the previous
    meta.json intact. `writeFileSync` import dropped.
  - Respawn race (final design after re-review): `finalizeSession(id, code, take)` replaces the
    daemon-server checkpoint → appendIncrements → closeSession chain. It DETACHES the writer from
    the map synchronously at the call (before any await). A respawn of the same id, whether
    through `trackHistorySession` (createOrAttach isNew, meta endedAt still null →
    `registerWriter`) or `openSession`, then gets a fresh writer. The detached finalization owns the
    dir only while no writer exists for the id (`owns()`): the final checkpoint's tmp file is
    removed instead of published, the final records are not appended, and endedAt is not stamped
    once a new writer exists. The earlier `{ onlyWriter }` token design is gone; it failed because
    `registerWriter` returned early and the new session shared the old writer.
  - `writeCheckpoint(writer, snapshot, owns)` (shared by the periodic `checkpoint()`, whose owner
    test is "the map still holds this writer"): after the async tmp write it checks `owns()`, then
    publishes with `renameSync` + `writeFileSync(log header)`. Both are sync, so nothing can
    interleave between the check and the publish (F2). The final records are appended with
    `appendFileSync` straight after the sync publish, with no await in between.
  - `resolveLogState` + `SessionWriter` moved unchanged to new `history-log-state.ts` to keep
    history-manager.ts under `max-lines`.
  - `DaemonPtyAdapter`'s exit handler is unchanged: an exit event arriving after a respawn can
    still stamp endedAt (needs a protocol change); the sweep's live list protects such sessions.
- `history-retention.ts` (new; split out to keep history-manager.ts under `max-lines`)
  - `sweepEndedHistory(basePath, maxTotalBytes, liveDirs, now)`: sizes every dir in the history
    root. Candidates = meta.json parses with a string `endedAt` at least 10 min old
    (`RETENTION_MIN_ENDED_AGE_MS`, covers the `ignoreCleanEnd` spawn-probe race) and the dir is
    not in `liveDirs`. Live, hibernated (immediate kill keeps `endedAt: null`, see
    hibernation-cold-restore-repro.test.ts), crashed/awaiting-restore, corrupt-meta, in-grace
    and worktree-GC dirs are never deleted. A scan error throws before anything is removed.
  - Review fix F2: the quota is measured against deletable bytes. kept = total − candidates;
    if kept alone exceeds the quota, nothing is deleted and a warning is logged; otherwise
    candidates are removed oldest `endedAt` first until candidate bytes ≤ quota − kept.
  - Review fix F3: each delete renames the dir to a `.deleting-<12 hex>` sibling, re-reads meta
    inside it, and only then `rmSync`s; if meta changed (session reopened), it is renamed back.
    Leftover `.deleting-*` dirs from an interrupted sweep are removed only if their meta is ended.
  - Review fix F1: `runHistoryRetentionSweep(provider, historyDir, quotaPath)` is the production
    entry. Reads the quota (none → null, provider never asked), then `provider.listProcesses()`
    (router/degraded/adapter; the router already fails closed if any adapter fails), maps ids with
    `getHistorySessionDirName` into `liveDirs`. No provider or a rejected list → sweep skipped.
    (The earlier `HistoryManager.sweepEndedSessions` used the main-process manager's always-empty
    writers map and was removed.)
  - `readHistoryRetentionQuotaBytes(file)` via BUILD-009 `readSafeJsonFile`: `{ "maxTotalMB": N }`
    (positive number) → bytes; missing, unreadable, wrong shape or no key → `null` (off).
- `daemon-init.ts`: after daemon init completes, `scheduleHistoryRetentionSweep()` fires once,
  30 s later (unref'd timer), calling `runHistoryRetentionSweep` with the module-level `adapter`
  read at fire time. Errors are logged, never thrown.
- `daemon-server.ts`: captures the writer token in `closeHistorySession`; also a mechanical
  lint fix (`import()` type annotation → `import type`) flagged by oxlint in this touched file.
- Unchanged: `releaseWithoutMarkingEnded` / SIGTERM keep-alive behaviour, `removeSession`,
  checkpoint writes (already atomic).

## Decision for Carson
Retention ships **off**. It only deletes after Carson creates
`~/Library/Application Support/dobius-plus/terminal-history-retention.json` with e.g.
`{ "maxTotalMB": 500 }`. Then only ended sessions (clean exit recorded ≥10 min ago) are
swept, oldest first, until the folder fits. Size quota only; no age-based rule was added.

## Tests
- `src/main/daemon/history-manager-meta-atomic.test.ts` (new; partial `node:fs` mock writes half of
  meta.json then throws ENOSPC; a readFileSync hook can flip endedAt to null on the Nth read):
  interrupted `closeSession` keeps cwd/cols/rows + restorability with no tmp left; interrupted
  `dispose` keeps meta; a session reopened between scan and delete is renamed back (no
  `.deleting-*` left).
- `src/main/daemon/history-retention.test.ts` (new): mixed active/ended/just-ended/corrupt dirs →
  only the 3 eligible ended dirs removed; oldest-first stop; quota vs deletable bytes; nothing
  deleted when non-deletable bytes exceed the quota; grace at quota 0; under quota; ended vs live
  `.deleting-*` leftovers; no leftover after a normal sweep; `runHistoryRetentionSweep` keeps a
  daemon-reported live id with a stale endedAt, skips on a rejected list or null provider, and
  never asks the daemon without a quota file; quota file parsing.
- `src/main/daemon/daemon-server-history-close-race.test.ts` (new): a barrier on the real
  checkpoint tmp write. (1) production respawn via `trackHistorySession` isNew while meta endedAt
  is null → new writer registered, endedAt null, dir holds only meta.json, no old records;
  (2) respawn via `openSession` → same; (3) control without respawn → checkpoint, records and
  endedAt all written; (4) an in-flight periodic `checkpoint()` is not published after a respawn.
- `src/main/daemon/daemon-init.test.ts`: the sweep is not called during init, and is called once
  after 30 s with `getDaemonProvider()`, `<userData>/terminal-history` and the quota path.
- `history-manager.test.ts` is back to its pre-build content (the retention tests moved).

## Mutation checks (each: break code → named test fails → restore → green)
- M1 `updateMeta` back to in-place write → both meta-atomic tests fail.
- M2 endedAt filter removed → caught by the re-check; filter + re-check removed → mixed test fails.
- M3 grace check removed → grace test fails.
- M5 sort removed → stop-at-quota and deletable-bytes tests fail.
- M6 re-check inside the moved dir removed → reopened-session test fails.
- F1a liveDirs dropped → daemon-reported-live test fails. F1b rejected list treated as empty →
  skip test fails. F1c daemon-init passes null instead of `adapter` → daemon-init wiring test fails.
- F2a budget ignores kept bytes → 3 tests fail. F2b no "kept exceeds quota" skip → skip test fails.
- F3a no rename-back → reopened-session test fails. F3b any leftover deleted → leftover test
  fails. F3c leftovers never cleaned → leftover test fails.
- Respawn race (all on the race test file): daemon-server back to the old chain → tests 1+2 fail;
  no detach (owner = same writer object) → test 1 + control fail; `owns()` always true → 1+2 fail;
  endedAt stamped unguarded → 1+2 fail; checkpoint owner check removed → 1+2 fail; tmp not
  removed → 1+2 fail; final append removed → control fails; periodic-checkpoint owner check
  always true → test 4 fails.

## Rollback
Revert the commit. meta.json format is unchanged apart from a trailing newline (readers use
JSON.parse). The quota file is only read, never written.

## Deviations
- Quota source is a new userData JSON file (spec gives no config location; adding a Settings
  field would touch shared settings types/UI outside this build's files).
- New file `src/main/daemon/history-retention.ts` (not in the spec's file list) holds the sweep
  and quota reader; needed to keep history-manager.ts within `max-lines`.
- `daemon-server.ts` touched (not in spec list) for the coordinator's root-race fix, plus one
  mechanical `consistent-type-imports` lint fix there.
- New `history-log-state.ts` (moved `resolveLogState`/`SessionWriter`) for `max-lines`.
- Checkpoint publish (rename + log header) is now sync (small metadata writes); the large tmp
  write stays async.
- Spec lists `removeSession` (history-manager.ts:302-308) as an anchor; it is unchanged — the
  sweep is a separate method so the explicit-close path keeps its semantics.
