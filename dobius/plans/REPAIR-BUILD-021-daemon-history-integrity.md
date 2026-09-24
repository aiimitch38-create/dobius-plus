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
  - New `sweepEndedSessions(maxTotalBytes, now)`: thin wrapper that passes this manager's live
    writer dirs to `sweepEndedHistory` in the new `history-retention.ts` (split out so
    history-manager.ts stays under the 300-line `max-lines` lint limit).
- `history-retention.ts` (new)
  - `sweepEndedHistory(basePath, maxTotalBytes, liveDirs, now)`: sizes every dir in the history root; only dirs
    whose meta.json parses with a string `endedAt` at least 10 min old (`RETENTION_MIN_ENDED_AGE_MS`,
    covers the `ignoreCleanEnd` spawn-probe race) and that this manager is not writing are
    candidates. Deletes oldest `endedAt` first, stops as soon as total ≤ quota, and re-reads
    meta right before each delete so a session id reopened since the scan is skipped. Live,
    hibernated (immediate kill keeps `endedAt: null`, see hibernation-cold-restore-repro.test.ts),
    crashed/awaiting-restore, corrupt-meta and worktree-GC dirs are never deleted. Any scan
    error throws before anything is removed (fail closed).
  - `readHistoryRetentionQuotaBytes(file)` via BUILD-009 `readSafeJsonFile`: `{ "maxTotalMB": N }`
    (positive number) → bytes; missing, unreadable, wrong shape or no key → `null` (off).
- `daemon-init.ts`: after daemon init completes, `scheduleHistoryRetentionSweep()` runs once,
  30 s later (unref'd timer): reads `userData/terminal-history-retention.json`; no quota → no-op.
  Errors are logged, never thrown.
- Unchanged: `releaseWithoutMarkingEnded` / SIGTERM keep-alive behaviour, `removeSession`,
  checkpoint writes (already atomic).

## Decision for Carson
Retention ships **off**. It only deletes after Carson creates
`~/Library/Application Support/dobius-plus/terminal-history-retention.json` with e.g.
`{ "maxTotalMB": 500 }`. Then only ended sessions (clean exit recorded ≥10 min ago) are
swept, oldest first, until the folder fits. Size quota only; no age-based rule was added.

## Tests
- New `src/main/daemon/history-manager-meta-atomic.test.ts` (partial `node:fs` mock that writes
  half of meta.json then throws ENOSPC):
  - interrupted `closeSession` endedAt update → meta keeps cwd/cols/rows, `endedAt: null`,
    `HistoryReader.hasRestorableHistory` true, no tmp left in the dir.
  - interrupted `dispose` → previous meta intact.
  - retention re-check: a session reopened between scan and delete is kept.
- Extended `src/main/daemon/history-manager.test.ts` "HistoryManager retention sweep":
  mixed active / ended / just-ended / corrupt-meta dirs over quota → only the 3 eligible ended
  dirs removed; oldest-first stop at quota; live writer never removed; grace period at quota 0;
  under quota deletes nothing; quota file missing/invalid/unreadable → null; MB → bytes.

## Mutation checks (each: break code → test fails → restore → green)
- M1 `updateMeta` back to in-place `writeFileSync` → both meta-atomic tests fail.
- M2 drop the `endedAt` string filter → still green on its own, because the pre-delete re-read
  (`readEndedAt(dir) !== candidate.endedAt`) also rejects null/corrupt meta (defense in depth).
  Dropping both → mixed-archive sweep test fails.
- M3 drop the grace-period check → grace test fails.
- M4 drop the live-writer guard → live-writer test fails.
- M5 drop the oldest-first sort → stop-at-quota test fails.
- M6 drop the pre-delete re-read → "retention skips a session reopened between the scan and the
  delete" (meta-atomic test file, readFileSync hook flips endedAt to null on the 2nd read) fails.

## Rollback
Revert the commit. meta.json format is unchanged apart from a trailing newline (readers use
JSON.parse). The quota file is only read, never written.

## Deviations
- Quota source is a new userData JSON file (spec gives no config location; adding a Settings
  field would touch shared settings types/UI outside this build's files).
- New file `src/main/daemon/history-retention.ts` (not in the spec's file list) holds the sweep
  and quota reader; needed to keep history-manager.ts within `max-lines`.
- Spec lists `removeSession` (history-manager.ts:302-308) as an anchor; it is unchanged — the
  sweep is a separate method so the explicit-close path keeps its semantics.
