# REPAIR BUILD-009C — remaining data-loss and fail-open stores (follow-up from BUILD-009B inventory)

Spec: brief-009C (not in EXECUTION-ORDER.md). Every item was re-verified in code before fixing; none refuted.

## Root causes (verified)
1. `remote-agent-trust-presets.ts:66-75` `readRemoteTextFile` returned `''` on ANY remote read error
   and on a binary result. `markRemoteCodexProjectTrusted` then wrote a one-entry
   `~/.codex/config.toml` over the real one (codex upsert on '' ≠ existing), and
   `markRemoteCopilotFolderTrusted` wrote `{trustedFolders:[ws]}` over `~/.copilot/config.json`.
   A Copilot config that parsed to a non-object (array/number) was also replaced with `{}`+folder.
2. `claude-accounts/runtime-auth-service.ts:1323-1337` `readSystemDefaultSnapshot` `rmSync`ed the
   system-default auth snapshot on any read OR parse error (EACCES/EIO included) and returned null,
   so callers acted as if the user had no system login (restore cleared runtime credentials;
   managed entry captured a fresh snapshot over it).
3. `destinations/destinations-store.ts` wrote `destinations.json` (Telegram botToken, SMTP password)
   via plain writeFileSync → umask mode (0644), and never tightened an existing file.
4. Fail-open JSON loads whose next save replaced the original:
   - `imessage-bridge/bridge-config.ts:80`: corrupt/unreadable → defaults; next update (every
     poll advances `lastSeenRowid`) rewrote the file, losing selfHandle/triggerPrefix.
   - `stats/collector.ts:167`: corrupt → "start fresh"; the next debounced save replaced lifetime
     totals (the comment "corrupt file is left on disk" was wrong; it was overwritten ≤5 s later).
     A wrong shape (`events` not an array) also crashed `record()`.
   - `speech/openai-api-key-store.ts:42`: a malformed legacy JSON key file returned null and was
     then treated as current-format ciphertext: with encryption available it went to
     `decryptString` (misleading error), with encryption unavailable the JSON TEXT was returned as
     the API key (fail open). No delete path exists; the fix adds none.

## Fix
1. `readRemoteTextFile`: returns '' only when the error is ENOENT (the relay forwards the remote
   errno as the JSON-RPC error code: `fs-handler-file-read.ts` stat → dispatcher `code`
   → `ssh-channel-multiplexer.ts:401-404`; message fallback `ENOENT:`). Any other error, or a
   binary result, logs `console.warn` (path + code only) and throws; nothing is written. Copilot:
   a non-object JSON config is left unchanged. Callers (`ipc/agent-trust.ts`,
   `dobius-runtime.ts markRemoteWorkspaceTrustedForAgent`) already catch = best-effort; the user
   still gets the agent's own trust prompt.
2. `readSystemDefaultSnapshot`: ENOENT → null. Any other read error → throws
   ("unreadable (EACCES); left it in place"), file untouched, so sync/restore/capture abort before
   mutating anything (all three callers read the snapshot before their first mutation). Bytes read
   but invalid JSON or invalid shape → renamed to `<file>.unreadable-<ms>` (never deleted) and
   treated as missing (previous behavior). If that rename fails it throws rather than treating a
   still-present corrupt file as missing.
3. destinations: `persist()` uses `writeSecureFile` (tmp 0600 + rename + chmod, user ACL on
   Windows); `load()` calls `hardenExistingSecureFile` first (same pattern as bridge-config #15).
   BUILD-009B's `SafeJsonFile` `mode` option is NOT on this branch (009B unmerged), so per the
   brief `writeSecureFile` is used and safe-json-file.ts is untouched.
4. - bridge-config: `readSafeJsonFile` (non-object → unreadable) + `keepUnreadableCopy`; while
     unreadable the session uses safe defaults (bridge off) and keeps edits in memory, and
     `persistConfig` refuses. Writes stay `writeSecureFile` (0600). Loaded once per session even
     when unreadable. Why: re-reading a repaired file mid-session would roll `lastSeenRowid` back
     and re-type already-delivered iMessage commands.
   - stats: `readSafeJsonFile` with a shape parser (object; `events` array; `aggregates` object
     with `countedPRs` array; forward-compat merge kept) + `keepUnreadableCopy`; while unreadable
     `writeToDiskSync` is a no-op for the session, counts stay in memory. Writes keep
     `writeFileAtomic` (compact JSON, throws on failure; the #49 tests rely on that).
   - openai key: a file whose first non-space char is `{` is legacy JSON; if it does not parse or
     lacks a non-empty `encryptedKeyBase64` string, `readOpenAiSpeechApiKey` throws "malformed;
     save the key again" and never calls `decryptString` or returns the bytes. File kept.
     Ciphertext never starts with `{` (macOS/Linux "v10/v11", Windows DPAPI 0x01).

## Tests (all seen FAILING against the pre-fix file, then passing)
- `remote-agent-trust-presets.test.ts`: codex/copilot × EACCES/EIO/CONNECTION_LOST → rejects, no
  createDir/writeFile; binary → no write; ENOENT → file created; copilot non-object → no write.
  Pre-fix: 9 fail.
- `runtime-auth-service.test.ts`: corrupt / wrong-shape / missing-keychain-fields snapshots now
  assert exactly one `.unreadable-` copy (corrupt: with the original bytes); new EACCES (chmod 000)
  tests on restore and on managed entry → rejects /EACCES/, snapshot bytes intact, no aside copy,
  runtime credentials and keychain unchanged. Pre-fix: 5 fail. (EACCES tests skip on win32/root.)
- `destinations-store.test.ts` (new): save → 0600 under umask 022; existing 0644 → 0600 on load.
  Pre-fix: 2 fail.
- `bridge-config.test.ts`: truncated JSON / array → load + two updates leave bytes identical, one
  quarantine copy, no tmp, session values kept; missing file still created. Pre-fix: 2 fail.
- `collector.test.ts`: truncated / array / events-not-array → counts in memory, file byte-identical,
  one quarantine copy; older file without events still merges and saves. Pre-fix: 3 fail.
- `openai-api-key-store.test.ts`: well-formed legacy JSON decrypts; truncated / missing field /
  empty field → throws /malformed/ with encryption available AND unavailable, decryptString not
  called, file kept. Pre-fix: 3 fail.
- Mutation checks beyond "restore original file": bridge-config persist refusal disabled → 2 fail;
  stats write refusal disabled → 3 fail.

## Deviations
- destinations: only the permission fix (item 3). Its fail-open load is migrated by BUILD-009B
  (unmerged, commit 7a829d47 on `stabilize/009B-safe-json-remaining-stores`), so this file WILL
  conflict at merge. Resolution: take 009B's SafeJsonFile version, add `mode: 0o600` to its
  options, and keep this build's `hardenExistingFile(filePath())` call in `load()` (before
  `file.get()`).
- bridge-config and stats do not use the `SafeJsonFile` class: bridge needs 0600 writes (no `mode`
  on this branch) and load-once semantics (replay safety); stats must keep throwing writes (#49
  tests) and compact JSON for a 10k-event log. Both use the same primitives
  (`readSafeJsonFile`, `keepUnreadableCopy`). Recovery after repair = next launch, not live.
- openai key store: the file is binary ciphertext, so SafeJsonFile does not apply; fixed in place.
  A read error (EACCES) now surfaces the fs error instead of "could not be decrypted".
- `hardenExistingSecureFile` also chmods the userData dir to 0700 (bridge-config already did).
- Out of scope, listed for a later build: `voice-conductor/lead-tab-store.ts:53` and
  `voice-conductor/persistent-work-registry.ts:38` (same fail-open JSON.parse-in-catch pattern;
  BUILD-033 is editing voice-conductor). Also `markRemoteCursorWorkspaceTrusted` treats any stat
  error as "missing" and rewrites a tiny marker file (no user data at risk); and Copilot's
  `existing.filter(string)` drops non-string `trustedFolders` entries on rewrite (pre-existing).

## Rollback
Revert the commit. Set-aside `*.unreadable-<ms>` files remain on disk; old code ignores them.

## Verification
- Typecheck, oxlint + react-doctor per file: see return block.
- Full suite: DEFERRED (coordinator).

## Lessons
- `hardenExistingSecureFile` chmods an owner's 0000 file to 0600, so an EACCES fixture for a
  store that hardens on load self-heals; use corrupt bytes for those stores' tests.

## Merge of stabilize/integration (03e03f7f, BUILD-009B merged)
- destinations-store.ts conflict resolved as the coordinator asked: 009B's SafeJsonFile version
  (including `save()`, which throws on a refused save) + `mode: 0o600` + `hardenExistingFile(filePath())`
  at the top of `load()`. The `writeSecureFile` persist from this build is gone.
- Mutation re-check after the merge: `mode` removed → the 0600 write test fails; harden call
  removed → the existing-0644 test fails.
- Typecheck exit 0. Targeted (this build's set + src/main/storage + DestinationsSection.test.tsx):
  38 files / 444 tests passed.

## Review round 1 (F1-F3)
- F1: `updateImessageBridgeSettings()` (renderer edits via `imessageBridge:updateConfig`) throws
  "imessage-bridge.json can't be read, so changes are not saved; repair or remove it" while the
  file is unreadable. Bridge-internal `lastSeenRowid` updates still use `updateImessageBridgeConfig`
  (session-only, no throw). The bridge status gains `unreadableDetail`. `ImessageBridgeSetting`
  now catches the rejected save, shows it with `toast.error`, re-fetches the real config, and shows
  a destructive notice while `unreadableDetail` is set (new en.json key `configUnreadable`).
  `bridge-service-start.test.ts` mock gains the new export.
- F2: the Keychain-write-failure rollback in `doSyncForCurrentSelection` wraps
  `restoreSystemDefaultSnapshot` in try/catch, logs the rollback error, and rethrows the Keychain error.
- F3: `ClaudeAccountService.rollbackRuntimeAuthBestEffort()` replaces the 4
  `forceMaterializeCurrentSelectionForRollback` calls. It never throws, so add's
  `safeRemoveManagedAuth` always runs and the original error is rethrown.
- Tests (each seen failing without the fix): bridge-config refusal test (throw replaced by warn → 1
  fail); ImessageBridgeSetting.test.tsx (pre-fix component → 1 fail); runtime-auth F2 test (inner
  try/catch removed → 1 fail); service.test.ts F3 add + select tests (pre-fix service.ts → 2 fail).
- Targeted: 44 files / 466 tests, 1 failure = no-top-level-translate.test.ts (baseline in
  basefail.txt; flags DestinationsSection.tsx, not this build's files). src/main/ipc run: only
  baseline files failed (mobile, notifications, pty, register-core-handlers, repos-remote).
