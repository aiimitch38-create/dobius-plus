# REPAIR BUILD-017 — secret storage fails closed, engine owners (#25 engine part)

## Root cause
Both engine credential owners downgraded to plaintext when Electron `safeStorage` could not encrypt:
- `persistence.ts` `encrypt()` returned the plaintext when `isEncryptionAvailable()` was false or
  `encryptString` threw, so `buildStateToSave()` wrote `opencodeSessionCookie`, `httpProxyUrl` (can
  embed proxy credentials) and `ui.browserKagiSessionLink` into `dobius-data.json` in clear, and every
  backup rotation copied them further.
- `speech/openai-api-key-store.ts` `saveOpenAiSpeechApiKey()` explicitly wrote the OpenAI key as
  utf-8 plaintext to `~/.dobius/openai-speech-token.enc` when encryption was unavailable (and an
  `encryptString` throw escaped to the IPC caller).

## Fix
- `persistence.ts`
  - `encrypt()` → `encryptSecret()`: returns `null` (never the plaintext) when encryption is
    unavailable or throws.
  - `Store.durableSecrets`: per secret field, the raw on-disk value and the plaintext it stands for,
    captured in `readStateFile()` for the candidate that actually loaded (primary or backup), and
    refreshed on every successful encryption.
  - `Store.secretForDisk()` (used by `buildStateToSave`, so both the async and sync flush paths):
    encrypts when possible; otherwise writes the previous on-disk value back unchanged (or nothing
    if there never was one). The in-memory `this.state` keeps the plaintext, so the session keeps
    working. A value that differs from the durable one is marked session-only (one `console.warn`
    naming the field, never the value). Clearing a secret still clears it on disk (user intent).
  - `Store.getSecretStorageStatus()` → `{ encryptionAvailable, sessionOnlySecrets }` for the UI.
  - Removed the now-unused `encryptOptionalSecret` / `decryptOptionalSecret` helpers.
- `speech/openai-api-key-store.ts`
  - `saveOpenAiSpeechApiKey()` encrypts via `tryEncryptOpenAiKey()`; on unavailable/throw it writes
    nothing, leaves any existing file untouched, keeps the key in the in-memory cache
    (`readOpenAiSpeechApiKey()` serves it) and returns `{ configured: true, sessionOnly: true }`.
  - New `getOpenAiSpeechApiKeyStatus()`; `hasOpenAiSpeechApiKey()` is true for a session-only key.
  - `clearOpenAiSpeechApiKey()` also clears the session-only flag.
- `ipc/speech.ts`: status/save handlers return the store's status (adds `sessionOnly`).
- `preload/index.ts`, `preload/api-types.ts`: optional `sessionOnly?: boolean` on the get/save
  result types so the renderer can show it (no UI change in this build).

## Tests
- New `src/main/persistence-secret-storage.test.ts` (real Store, temp userData, fake secrets):
  unavailable → file contains none of the three secrets, session reads them, status lists all
  three; `encryptString` throws → same; existing encrypted values byte-identical after an unrelated
  save while unavailable; new value while unavailable → old ciphertext kept, new value session-only;
  encryption back → session value persisted encrypted, status clears.
- Extended `src/main/speech/openai-api-key-store.test.ts`: unavailable → no file, key usable,
  status sessionOnly; `encryptString` throws → no file, no throw; existing file byte-identical;
  encryption back → file written, sessionOnly false.
- Mutation checks (each made tests fail, then restored):
  - M1 original openai-api-key-store.ts (plaintext write) → 4 of 4 new tests fail.
  - M2 `secretForDisk` falls back to returning plaintext → 4 of 5 persistence tests fail.
  - M3 `secretForDisk` drops the durable value (writes null) → the 2 "existing encrypted value
    intact" tests fail.
- Targeted: speech dir, `ipc/speech.test.ts`, `persistence.test.ts`, new test → 415/429 on the
  first run; the 14 failures were all `Test timed out in 30000ms` in persistence.test.ts under
  machine load average 120-200 (parallel builders). Re-running exactly those 14 by name with
  `--testTimeout=180000` → 22 passed (all matching tests), 0 failed.

## Review round 1 (coordinator findings F2, F3)
- F3, a pre-existing bug that could permanently lose a secret. When `decryptString` threw at load (keychain denied or reset), `decrypt()` handed the
  ciphertext to the app as if it were plaintext. A later save that could encrypt then encrypted it
  a second time, and the real secret was lost. Fix:
  - `decrypt()` → `decryptSecret()`, which returns `{ onDisk, plaintext, kind }`.
  - `kind` is `encrypted` when decryption worked.
  - It is `undecryptable` when decryption failed (or encryption is unavailable) and the value is a
    strict base64 string of at least 24 characters. In that case the value in memory is blank, the
    blob stays on disk and is never re-encrypted, and a blank save writes the blob back.
  - Any other value is `legacyPlaintext` (written by a pre-encryption build). It stays readable and
    is encrypted on the next save that can encrypt.
  - `secretForDisk()` now writes an unchanged `encrypted` value back verbatim, with no re-encrypt
    (this also means fewer keychain calls). A value the user types in replaces an undecryptable
    blob only when that value can be encrypted.
  - The status gains `undecryptableSecrets`.
- F2: new read-only IPC `settings:getSecretStorageStatus` (main/ipc/settings.ts), plus the typed
  preload method `window.api.settings.getSecretStorageStatus()`. The type lives in the new
  `src/shared/secret-storage-status.ts`. The status carries field names only. No UI change.
- New tests: unchanged secret is not re-encrypted. When decrypt throws at load, the value is blank
  in memory, the file bytes are unchanged after an unrelated save, and a relaunch with a working
  keychain decrypts the originals. When encryption is unavailable at load, the encrypted value
  stays intact through saves before and after recovery. Legacy plaintext is still readable and
  gets encrypted on save. The settings IPC handler returns the store status.
- Mutation checks, each seen failing and then restored:
  - M4a: the decrypt failure path treats every value as legacy plaintext → 2 tests fail.
  - M4b: remove the unchanged-value shortcut → 1 test fails.
  - M4c: a blank value drops the undecryptable blob → 2 tests fail.
  - M5: handler channel renamed → 1 test fails.
- Targeted run (persistence, new test, ipc/settings, speech dir, ipc/speech) with
  `--testTimeout=180000`: 453/454 passed. The one failure was `returns empty repos when no data
  file exists`, which has its own 15 s timeout, under load average ~112-155. Run alone, it passes.
- Known limit: a legacy plaintext cookie that happens to be strict base64 of 24+ characters is
  treated as undecryptable. It is blank in memory and kept on disk, not lost.

## Rollback
Revert the commit. Nothing on disk changes format: encrypted values are the same base64
safeStorage blobs as before.

## Deviations from EXECUTION-ORDER.md
- Edited `ipc/speech.ts` and two type lines in `preload/index.ts` / `preload/api-types.ts` (outside
  the named files) so the session-only status actually reaches the renderer, per the brief's
  "surface a clear status the UI can show". No renderer/UI change.
- Persistence status is exposed via `settings:getSecretStorageStatus` IPC (review F2), which touches
  `ipc/settings.ts`. It is not shown in any UI yet.
- `communications/providers/provider-api-key-store.ts` (the Dobius part of #25) is BUILD-018's.

## Known limits (not changed here)
- If a legacy plaintext value is on disk and encryption stays unavailable, the save writes that
  same existing value back (not new plaintext; deleting it would destroy user data). It is
  encrypted on the first save once safeStorage works.
- A session-only value is persisted on the next save after encryption recovers; the unchanged-state
  hash skip means a recovery with no other state change does not force a write.
- Same for `openai-api-key-store.readOpenAiSpeechApiKey()` reading a legacy plaintext file.

## Lessons
- `persistence.ts` loads candidates (primary, then backups) through `readStateFile()`; per-load
  side state must be committed only for the candidate that returns a result.
