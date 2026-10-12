# REPAIR BUILD-009 — safe JSON store contract + agents-domain stores (#29 #30 #46)

## Root cause
Eight stores shared one template: `load()` caught every read/parse error, cached an empty
default, and the next `persist()` atomically renamed that emptiness over the real file.
`agent-runs-store.ts` persisted inside `loadRuns()` itself, so one EACCES / truncated file at
launch wrote `[]` immediately (#29). ENOENT, EACCES and corrupt JSON were indistinguishable (#30).
Separately, `dismissBriefingItems()` kept only `ts > now`, deleting all history instead of hiding
the 48 h view (#46). Every store also used a `pid`-only tmp name, so two writers in one process
could share a tmp file.

## Fix
- New `src/main/storage/safe-json-file.ts`:
  - `readSafeJsonFile()` → `{status:'ok'|'missing'|'unreadable', value, detail}`; never writes.
    `parse` returning `undefined` (wrong top-level shape) counts as unreadable.
  - `writeJsonFileAtomic()` — unique tmp `<file>.<pid>.<12 hex>.tmp` + rename; tmp removed on failure.
  - `SafeJsonFile<T>` — per-store cache. While unreadable: copies the bad file once to
    `<file>.unreadable-<ms>` (never deleted; best-effort, EACCES files can't be copied),
    keeps session-only values in memory, refuses every save, and re-reads on every access so a
    repaired file recovers without a restart. A save whose value was built from the session copy
    is also refused if the file became readable in between (would otherwise clobber the repair).
- Refusal policy: **no-op + console.error, `set()` returns false, never throws.** Why: every
  store already treated a failed write as warn-and-continue, and callers include run
  finalization, heartbeat and the Asana poller, where a throw would abort bookkeeping mid-run.
  Matches BUILD-001 `agents-config-store` `persist()` returning boolean.
- Paths unchanged: every migrated store keeps `path.join(app.getPath('userData'), <same name>)`.
  File formats unchanged (briefing items gain an optional `dismissed: true`).
- Migrated: agents-store, agent-runs-store, agent-notification-store, agent-briefing-store,
  agent-draft-store, asana-dispatch-ledger, asana/asana-config, communications/team-store.
  Missing file keeps each store's first-run default.
- agent-runs-store: restart reconciliation (running → error) is persisted once, only after an
  `ok` read; a missing file no longer creates `[]` on disk.
- asana-dispatch-ledger: `claimTask` returns null while the ledger is unreadable (fail closed —
  the unreadable ledger may hold this task's claim; a duplicate claim = duplicate paid run).
  `releaseClaim` unchanged.
- #46: dismiss marks items `dismissed: true` instead of deleting; the 48 h list hides them.
  MAX_ITEMS=200 retention unchanged.

## Tests
- `src/main/storage/safe-json-file.test.ts` (table-driven): malformed, truncated, wrong shape,
  EACCES read → original bytes intact after load + save, quarantine copy; quarantine once;
  repaired file recovers; stale session save refused after repair; missing file creates nothing
  on load; EACCES write (read-only dir) → original intact, no tmp; rename failure → tmp removed +
  throws; two writers → unique tmp names, one valid file.
- `src/main/storage/safe-json-store-migrations.test.ts`: table over all 8 stores — unreadable
  file, then load + every save API → same bytes, same mtime, no tmp, one quarantine copy.
  Runs reconciliation still persists after ok parse; no file written on first launch.
  Briefing dismiss keeps older history (also across reload).
- Mutation checks (each made the suite fail, then restored): M1 remove unreadable save refusal
  (12 fail); M2 quarantine every access (12 fail); M3 remove stale-session refusal (1); M4 pid-only
  tmp (1); M5 no tmp cleanup (1); M6 briefing dismiss back to delete (1); M7 ledger claims while
  unreadable (1); M8 runs reconcile on missing (1).

## Deviations from EXECUTION-ORDER.md
- Root is NOT `getCanonicalUserDataPath()`: every migrated store resolves
  `app.getPath('userData')` today; switching would move data files. Root unification is BUILD-014.
- Ledger fail-closed claim added (not in spec) — without it an unreadable ledger re-dispatches tasks.
- Lint: fixed pre-existing `curly` errors in agents-store.ts and agent-runs-store.ts; to keep
  agents-store.ts under max-lines after that (pre-existing 325 → now under 300) its `persist()`
  wrapper was inlined as `file.set()`.

## Rollback
Revert the commit. Quarantined `*.unreadable-<ts>` copies stay on disk. Old code ignores the
briefing `dismissed` flag (dismissed items reappear in the 48 h view; nothing is lost).

## Lessons
- oxlint prints nothing for clean files; a multi-file invocation in this worktree printed
  "No files found" — lint per file to be sure the file was actually checked.

## Verification
- Typecheck exit 0. oxlint + react-doctor clean on every changed file.
- Targeted: 8 files / 59 tests green (storage/*, ledger, drafts, draft-approval, agents-config, asana-config, team-store).
- Wider run of src/main/{agents,asana,communications}: only failures were agent-provider.test.ts (baseline),
  snapshot-rpc-methods.test.ts (timeout under load; passed when re-run alone), and
  verify/auth-handshake-integration + verify/run-verification (need port 3300, held by the live Dobius+ app pid 625).
- Full suite: DEFERRED — coordinator killed vitest for machine load and will run it serially.
