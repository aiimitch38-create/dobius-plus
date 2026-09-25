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

## Rollback
Revert the commit. Nothing on disk changes format: encrypted values are the same base64
safeStorage blobs as before.

## Deviations from EXECUTION-ORDER.md
- Edited `ipc/speech.ts` and two type lines in `preload/index.ts` / `preload/api-types.ts` (outside
  the named files) so the session-only status actually reaches the renderer, per the brief's
  "surface a clear status the UI can show". No renderer/UI change.
- Persistence status is exposed as `Store.getSecretStorageStatus()` only; it is not yet wired to IPC
  or Settings UI (keeps the persistence diff to the secret code; UI is out of scope).
- `communications/providers/provider-api-key-store.ts` (the Dobius part of #25) is BUILD-018's.

## Known limits (not changed here)
- Read side: when encryption is unavailable at load, `decrypt()` still returns the stored string
  as-is (pre-existing, keeps legacy plaintext values readable). If a legacy plaintext value is on
  disk and encryption stays unavailable, the save writes that same existing value back (not new
  plaintext; deleting it would destroy user data). It is encrypted on the first save once
  safeStorage works.
- A session-only value is persisted on the next save after encryption recovers; the unchanged-state
  hash skip means a recovery with no other state change does not force a write.
- Same for `openai-api-key-store.readOpenAiSpeechApiKey()` reading a legacy plaintext file.

## Lessons
- `persistence.ts` loads candidates (primary, then backups) through `readStateFile()`; per-load
  side state must be committed only for the candidate that returns a result.
