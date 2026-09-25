# REPAIR BUILD-012 — Communications identity and blobs (#36 #37) · Dobius

## Root cause
- #36 `communications/participant-identity-store.ts` `readStoredIdentity()`: every failure after
  `existsSync()` (read error, `safeStorage` decrypt throw, encryption transiently unavailable so
  the ciphertext was parsed as utf-8, bad JSON, wrong shape) fell into one catch that renamed the
  file to `.undecryptable-<ms>` and returned null. `ensureParticipantIdentity()` then generated
  and saved a brand-new keypair. One locked Keychain prompt, or one EACCES, permanently replaced
  the owner's Nostr identity (peers see a new person; old DMs/NIP-44 data tied to the old key).
  Writes were `writeFileSync(path, …)` straight onto the real file, so a crash mid-write left a
  truncated identity that the next read then "recovered" by generating a new one.
- #36 `communications/agent-participant-identity-store.ts` `readRegistry()`: the same catch for
  the shared registry of all agents: any failure → rename, `{}`, and every agent silently got a
  new identity on next use. Same non-atomic `writeFileSync`.
- #37 `communications/workstation/media/blob-store.ts` `storeBlob()`: `if (!existsSync(path))
  await writeFile(path, bytes)`. A write interrupted mid-way left a partial file at the final
  content-addressed path. Every later upload of the same bytes saw "exists" and skipped the
  write, and the HTTP server / `readBlobBytesByUrl` served the partial bytes (with an
  `immutable` one-year cache header) forever.

## Fix
- Both identity stores:
  - Reads: only ENOENT means "no identity". Every other failure throws a new exported error
    (`ParticipantIdentityUnavailableError` / `AgentIdentityRegistryUnavailableError`, with
    `filePath` and a short `detail`: errno, `decrypt failed: <msg>`, `encryption unavailable`,
    or `unexpected … shape`; never file contents). Nothing is renamed, written or generated.
    Failures are not cached, so the next call re-reads and a transient failure recovers the
    same identity without a restart. One `console.error` per distinct detail.
  - Decode order: decrypt when encryption is available; if that throws, or encryption is
    unavailable, accept the raw bytes only if they parse as a valid plaintext identity (files
    written by the existing plaintext fallback). Anything else is unavailable.
  - Registry parse validates every entry has string `privateKeyHex` / `pubkeyHex`.
  - Writes go through `writeSecureFile()` (shared/secure-file.ts): unique temp + rename, 0600,
    Windows ACL. An interrupted write leaves the previous file intact. Same bytes on disk as
    before (safeStorage ciphertext, or plaintext when encryption is unavailable).
- Participant explicit paths:
  - `importParticipantPrivateKey()` (user import / legacy migration) may replace an unavailable
    identity, but first renames the old file to `<file>.unavailable-<ms>`; if that rename fails
    the import fails. It always runs this check, even when a username is passed.
  - Explicit reset = existing sign-out (`identity-lifecycle.signOut` → `clearParticipantIdentity`),
    unchanged; tested to produce a new identity after an unavailable one.
- Blob store:
  - `readVerifiedBlob(sha, ext)`: reads the file and returns it only if its SHA-256 equals the
    name; null when missing or incomplete. Used by `storeBlob`, the HTTP server (incomplete →
    404, never served) and `readBlobBytesByUrl` (throws "Blob is missing or incomplete").
  - `storeBlob` publishes via `publishBlob()`: async `writeFile` to `uniqueTmpPath()` then
    `rename`, temp removed with `removeTempFile()` on failure (both from BUILD-009
    safe-json-file.ts). A partial file already at the final path is replaced atomically by the
    verified bytes (repair).
  - Once per process, `storeBlob` runs `sweepStaleTempFiles()` on the media dir with the
    uniqueTmpPath pattern, so temps from a crash are removed (10-minute age / live-pid rules).

## Files
- `src/main/communications/participant-identity-store.ts`
- `src/main/communications/agent-participant-identity-store.ts`
- `src/main/communications/workstation/media/blob-store.ts`
- `src/shared/secure-file.ts` (one line: `writeSecureFile` contents `string | Uint8Array`)
- Tests: `participant-identity-store.test.ts`, `agent-participant-identity-store.test.ts`,
  `workstation/media/blob-store.test.ts`

## Tests
- safeStorage mock now produces realistic ciphertext (`ENC:` prefix, decrypt throws on anything
  else), so ciphertext is not accidentally valid plaintext JSON.
- Participant (new): transient decrypt throw → throws, file bytes + dir listing unchanged, no
  encrypt call, next call returns the original identity; encryption unavailable over an
  encrypted file → ensure/get/sign all throw the unavailable error, then original returns;
  table (chmod 000 EACCES, corrupt JSON, wrong shape) → throws twice, bytes + listing unchanged;
  legacy plaintext file readable once encryption is available; injected `renameSync` failure
  during a write → previous file intact, no temp left, reload gives the original; sign-out reset
  after unavailable → new identity; import over unavailable → old bytes kept at `.unavailable-*`.
- Agent registry (new): same transient-decrypt, unavailable-encryption (no new agent-2 identity,
  signAsAgent throws), table (EACCES / corrupt / bad entry), legacy plaintext, interrupted write.
- Blob store (new): interrupted write (mock writes half the bytes to the temp then throws) →
  rejects, media dir empty; same-hash retry → exact bytes on disk, via `readBlobBytesByUrl` and
  HTTP. Half-written file from an older build → repaired on the next store. Incomplete file →
  HTTP 404 and `readBlobBytesByUrl` throws. Stale temp swept, fresh temp kept.
- Replaced the two old tests that asserted the #36 bug ("recovers with a fresh identity/registry
  when the existing file cannot be decrypted").
- Mutation checks (each seen failing, then restored; files diffed identical after):
  - M0 original file for each of the 3 stores → 9 / 7 / 4 new tests fail.
  - M1 participant decode failure returns null (regenerate) → 6 fail; M1b read error returns
    null → 1 fail.
  - M2 participant non-atomic `mkdir + writeFileSync` → interrupted-write test fails.
  - M3 no plaintext fallback → 2 fail. M4 import does not move the old file aside → 1 fail.
  - M5 agent decode failure returns `{}` → 4 fail. M6 agent non-atomic write → 1 fail.
  - M7 blob read skips hash check → 2 fail. M8 blob writes straight to the final path → 1 fail.
  - M9 no temp sweep → 1 fail.

## Verification
- `pnpm run typecheck` exit 0.
- oxlint + react-doctor config: clean on all 7 changed files (probe file confirmed oxlint
  reports errors, so empty output is real).
- Targeted: the three test files 51/51. Wider run (shared/secure-file*, minimax cookie store,
  communications/workstation, identity, providers, canvas, verify, buzz migration, observer
  crypto, runtime-metadata): 376 passed, 2 failed, 1 file errored:
  - `providers/agent-provider.test.ts`: in basefail.txt (electron mock has no `app`).
  - `verify/auth-handshake-integration.test.ts`: refuses to run because port 3300 is in use on
    this machine (live Dobius relay). Environment, not code.
  - `verify/run-verification.test.ts` canvas.getUserNotes SHAPE_FAIL: fails identically with all
    four source files restored to HEAD; alone with the fix it skips (relay port busy).
- Full suite: DEFERRED (coordinator).

## Deviations from EXECUTION-ORDER.md
- Edited `src/shared/secure-file.ts` (one type widening) so the binary safeStorage ciphertext can
  go through the existing atomic 0600/ACL writer. Chosen over `writeFileAtomic` (utf-8 string
  only, no 0600/ACL). No behavior change for existing string callers.
- Blob publish uses `uniqueTmpPath` + `removeTempFile` inline with async `writeFile`/`rename`
  instead of `writeFileAtomic`, because that helper is sync + utf-8 string only and media blobs
  can be large (sync write would block the main thread).
- Added a one-time stale temp sweep in the media dir (the new temp+rename introduces temps a
  crash could leave behind).
- Not changed: plaintext write when `safeStorage` is unavailable (#25 applies to communications
  identities per BUG-MATRIX, but no build lists these files for it). Failing closed on that
  write would give non-keyring machines a new identity every launch, i.e. the #36 harm.

## Decisions for Carson
- The old "undecryptable → start a fresh identity automatically" recovery is gone. After an
  ad-hoc re-sign that permanently loses Keychain access, Communications reports the identity as
  unavailable until he imports a backup (old file kept as `.unavailable-*`) or signs out
  (new identity). Agents' registry: stays unavailable until the Keychain grant returns or the
  file is removed by hand; no in-app agent reset exists.

## Rollback
Revert the commit. File formats are unchanged (same ciphertext / plaintext JSON, same blob
names); old code reads files written by this build.

## Lessons
- A mock `safeStorage` whose ciphertext equals the plaintext hides plaintext-fallback bugs; make
  the fake ciphertext non-JSON.
- `username ?? readSomething()` short-circuits a side effect; call it unconditionally.
