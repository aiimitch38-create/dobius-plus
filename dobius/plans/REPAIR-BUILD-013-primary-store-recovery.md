# REPAIR BUILD-013 — Primary store recovery (Upstream)

Bugs: #31, #32, #33, N6. File: `dobius/src/main/persistence.ts` (engine). Tests: `dobius/src/main/persistence.test.ts`.

## Root causes (re-traced on 2026-09-24, pre-fix line numbers at HEAD 68191679)

- **#31 / N6** `restoreFromBackup` (:2786-2804) accepted the first backup that merely passed `JSON.parse`, then
  `writeFileSync(dataFile, raw)` straight over the primary (:2796, non-atomic) and re-ran `load(false)` (:3376).
  A backup whose migration/normalization threw was therefore promoted over the primary, the recursive load failed,
  and the session started from defaults while the original primary was already gone. Newer valid backups
  (e.g. `.bak.2` when `.bak.1` is bad) were never tried. Once on defaults, hourly rotation (:3644-3651, :3692-3695)
  copied the defaults-based primary into `.bak.0` and shifted the ring, so five hours later every recovery source was gone.
- **#32** The `workspaceSession` loader (:3311-3332) and the per-host loader (:541-548) returned the whole default
  session on any zod failure, so one bad field (one tab title, one layout) erased every tab and layout.
- **#33** `writeToDiskAsync` awaited `rotateBackupsAsync` (:2734-2755) — an rm, four renames and a copy with an
  `await` between each. The quit `flush()` → `writeToDiskSync` → `rotateBackupsSync` could run while the async
  rotation was suspended between two steps (`shouldRotateBackups` sees `.bak.0` missing mid-shift and returns true),
  so both rotations shifted the same slots: generations lost and `.bak.0` duplicated.

## Fix

- `load()` now: `readStateFile(dataFile)` (the existing parse+migrate+normalize block, moved unchanged into its own
  method, reading from a `sourceFile` argument and logging which stage failed: read / parse / migrate/normalize).
  On failure it preserves the failed primary as `dobius-data.json.failed-<ms>` (copy), then `restoreFromBackup`
  runs `readStateFile` on each `.bak.N` newest-first and uses the first one whose **complete** load succeeds.
  Candidates are only read. The chosen backup is promoted with `copyFileSync(backup → tmp)` + `renameSync(tmp → primary)`;
  on any failure the tmp is removed and the primary is left as it was (the loaded state is still used; the next save
  writes atomically). The recursion (`load(false)`) is gone; the tail of the old `load()` is `finishLoad()`.
- If every candidate fails and at least one `.bak.N` exists, `backupRotationSuspended` stops rotation for this session so defaults
  never rotate into the ring.
- `parseWorkspaceSessionSalvaging` (used for `workspaceSession` and for each host partition): on a zod failure,
  `salvageWorkspaceSession` removes only what each zod issue points at — a top-level field resets to its default,
  an array element (e.g. one tab) is spliced out, a record entry (e.g. one layout) is deleted — and re-validates
  (max 10 passes; otherwise the old defaults fallback). A warning lists the dropped paths (paths only, no values).
- Both write paths now call `rotateBackupsSync`; `rotateBackupsAsync` is deleted. A rotation (one unlink, four
  renames, one copy, at most once per hour) can no longer be interleaved by the quit flush. The existing
  `writeGeneration` check still makes the async writer skip rotation when a flush superseded it.

## Tests (persistence.test.ts)

- `rolling backups` › `recovers the newest backup whose full load succeeds without touching any candidate (#31)`:
  primary = bad migration, `.bak.0` invalid JSON, `.bak.1` bad migration, `.bak.2`/`.bak.3` valid → loads `.bak.2`;
  every candidate's bytes and mtime unchanged; primary = `.bak.2` bytes; failed primary preserved; no tmp left.
- `never rotates defaults into the backup ring when every candidate fails (#31)`.
- `restores the primary atomically via tmp + rename (N6)`: at the rename, primary still holds the old bytes and the
  tmp holds the full backup.
- `leaves the primary untouched when the restore write fails (N6)`: injected `renameSync` EIO → primary bytes
  unchanged, candidates unchanged, no tmp, state still loaded.
- `backup rotation interleaved with the quit flush` (#33): sweep firing `flush()` at async fs step 1..12 of the
  debounced writer; each time `.bak.0` = latest state, `.bak.1-4` = old-0..old-3, no `.bak.5`.
- `workspace session field salvage` (#32): one invalid tab dropped, other tabs in both worktrees and all layouts kept;
  invalid top-level `activeRepoId` resets to null and a bad layout entry is dropped while tabs survive.
- Test harness: pass-through `vi.mock('node:fs')` (`renameSync`) and `vi.mock('node:fs/promises')` wrappers with
  hooks that are `null` (inert) unless a test sets them.

### Mutation checks (each test proven able to fail)

- Whole original `persistence.ts` (HEAD) with the new tests: all 12 new behaviour tests fail
  (#31 ×2, N6 ×2, rotation sweep steps 4-9, salvage ×2); the other 18 in the filtered set pass.
- `backupRotationSuspended` never set → `never rotates defaults…` fails.
- Promotion as direct `writeFileSync(dataFile, …)` → both N6 tests fail.
- Salvage disabled → both salvage tests fail.
- Candidate check reverted to JSON-parse-only → `recovers the newest backup…` fails.
Original file restored and byte-compared after each mutation.

## Deviations from EXECUTION-ORDER.md

- Plan anchor `:3699-3710` (quit flush) needed no edit: the race is removed by making rotation synchronous on the
  async path (`:3650`) instead of adding a new writer protocol. Trade-off: one hourly rotation (≈1.6 MB copy) runs
  on the main thread, the same work `flush()` already did synchronously.
- BUG-MATRIX #31 asks to "separate read, migration and normalization failures". Migration and normalization are
  interleaved in one 530-line block, so the log distinguishes read / parse / migrate-normalize (three stages, not four).
- Salvage also applies to per-host partitions (`workspaceSessionsByHostId`), same loader shape; existing host
  partition test still passes.
- Pre-existing test `loads legacy pane aliases from very large persisted split layouts` times out (30 s) under the
  machine's current load (load average ~170); it also times out on the unmodified HEAD file (49.9 s), so it is
  load-induced, not caused by this change. It passed in the final targeted run (381/381).
- Full suite: DEFERRED. The coordinator killed all vitest processes (machine load ~480) and will run it serially.

## Rollback

Revert the commit. Files created by this build at runtime: `dobius-data.json.failed-<ms>` copies (only on a failed
load) — safe to keep or delete manually; nothing reads them.

## Lessons

- A backup "validity" check must run the same code path the real load runs; JSON-parse-only validation is what let a
  bad candidate destroy the primary.
- `vi.mock('node:fs')` pass-through wrappers with null hooks give exact fault injection without touching other tests.
