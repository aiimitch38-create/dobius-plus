# REPAIR BUILD-018 — Dobius secrets (#24, #15, #25 Dobius part)

## Root causes
- **#24** The ElevenLabs API key was a normal settings field (`settings.voice.elevenlabsApiKey`).
  The Store serializes settings as-is, so the key sat in plaintext in `dobius-data.json`, and the
  backup ring (`.bak.0..4`) copied it on every rotation. The renderer also read and wrote the
  key through `settings:get` / `settings:set`.
- **#15** `imessage-bridge/bridge-config.ts` `persistConfig()` wrote the tmp file with no `mode`,
  so the file ended up at the umask default (0644 under umask 022). The file holds the user's
  phone/email handle. Files written by older builds were never re-restricted.
- **#25 (Dobius part + extra scope)** `provider-api-key-store`, `asana-token-store`,
  `minimax-cookie-store`, `jira/client` and `linear/client` all wrote the secret in plaintext
  (or a `plaintext` envelope) when `safeStorage.isEncryptionAvailable()` was false. An
  `encryptString` throw also escaped to the caller (provider, asana, jira, linear).

## Fix
- New `src/main/jarvis/elevenlabs-key-store.ts` (mirrors 017's `openai-api-key-store`):
  - `~/.dobius/elevenlabs-token.enc`, written with `writeSecureFile` (atomic, 0600 / user ACL).
  - Fails closed. If encryption is unavailable or throws, nothing is written, any existing file
    stays byte-identical, and the key is kept in memory for this session (`sessionOnly`).
  - `readElevenLabsApiKey()` never decodes stored bytes as plaintext.
  - `resolveElevenLabsApiKey(voice)`: protected store first, then a legacy settings key that
    has not been migrated yet (no lockout). A decrypt failure is logged (message only) and
    falls through.
  - `migrateElevenLabsKeyOutOfSettings(store)` uses only the public Store API
    (`getSettings`, `updateSettings`, `flush`). If the key persists encrypted, it removes
    `voice.elevenlabsApiKey` from settings and flushes, so the primary is rewritten at once and
    the next backup rotation copies a key-free file. If encryption is unavailable or the write
    throws, settings are left untouched (the key keeps working) and it retries next launch.
    It never logs the key.
- `jarvis-ipc.ts`:
  - Runs the migration first in `registerJarvisIpcHandlers`.
  - The two agent paths (`conversationMemory`, `agentSignedUrl`) read the key through
    `resolveElevenLabsApiKey`.
  - New channels: `jarvis:getElevenLabsKeyStatus`, `jarvis:saveElevenLabsKey` and
    `jarvis:clearElevenLabsKey`. They return `{configured, sessionOnly}` only; the key never
    goes back to the renderer.
  - A successful (non-session) save or a clear also drops any legacy settings key.
- `elevenlabs-client.ts` (key-reading part only, lines 21-41): `resolveElevenLabsConfig` takes an
  injectable `readStoredApiKey` (default: the key store) and checks the voice ID first, so the
  store is only read when a voice is configured. Lines 75-95 (BUILD-038's) are untouched.
- `ipc/settings.ts` `settings:set`: a renderer `voice` object can no longer put a key into
  settings. `keepStoredElevenLabsKey` drops the renderer's `elevenlabsApiKey` and keeps only the
  value already stored (an unmigrated legacy key), so a voice update cannot wipe it either.
- Renderer `JarvisSettingsSection.tsx`: the key field is now write-only. It starts empty and the
  placeholder says a key is saved. Save sends a new key through `saveElevenLabsKey` and sends
  only voice/agent IDs through voice settings. There is a small "Remove key" button, the only way
  to clear now that an empty field means "keep". A session-only save shows a warning toast.
- Preload `index.ts` / `api-types.ts`: the three typed methods.
- `bridge-config.ts`: `persistConfig` uses `writeSecureFile` (tmp + rename, 0600, Windows ACL).
  `loadConfigFromDisk` first runs `hardenExistingSecureFile` on an existing file (chmod 0600 of
  files written by older builds; a failure is logged, not thrown).
- `provider-api-key-store`, `asana-token-store`, `minimax-cookie-store`: same session-only
  pattern as 017. A `try*Encrypt` helper returns null on unavailable/throw. When it does, nothing
  is written, the cache holds the value, a session-only flag makes `has*` true, and `clear*`
  resets the flag.
- `jira/client.ts`, `linear/client.ts` `writeEncryptedToken`: on unavailable/throw, nothing is
  written. The callers already cache the token and `hasStoredToken` already counts the cache, so
  the site/workspace stays connected for this session only.

## Tests (all seen failing with the fix removed, then passing)
- `jarvis/elevenlabs-key-store.test.ts` (9): encrypted save/read; unavailable → no file,
  session key; encrypt throws → no file; existing file byte-identical; no plaintext decode;
  migration success (key removed from settings, flush called, still resolvable); migration with
  encryption unavailable → settings untouched, key usable; migration write failure → key usable;
  no-key no-op.
- `jarvis/elevenlabs-key-migration-store.test.ts` (2, real Store + temp userData + temp home):
  - After migration the primary `dobius-data.json` and the newly rotated `.bak.0` contain no
    key, and the pre-existing backup (now `.bak.1`) is kept.
  - A migration failure leaves the primary byte-identical and the key usable.
- `jarvis/elevenlabs-client.test.ts`: the stored key beats env; env fallback; the store is not
  read without a voice ID.
- `imessage-bridge/bridge-config.test.ts` (2): created under umask 022 → 0600; existing 0644 →
  0600 on load.
- `ipc/settings.test.ts` (+2): a renderer voice update cannot write a key; an unmigrated legacy
  key survives a voice update that omits it.
- `asana/asana-token-store.test.ts` (5), `communications/providers/provider-api-key-store.test.ts`
  (5), `minimax-cookie-store.test.ts` (plaintext-write test replaced by 2 fail-closed tests),
  `jira/client.test.ts` (+2), `linear/client.test.ts` (+2). These cover: unavailable → no file
  (jira/linear scan every file under `.dobius` for the token), encrypt throws → no file,
  existing file intact, session value usable.
- Renderer `JarvisSettingsSection.test.tsx` (4): the saved key is never shown; Save routes the
  key to the key store and not to voice settings; editing only the voice ID leaves the key
  alone; Remove key clears it. `VoicePane.test.tsx` mock extended with `getElevenLabsKeyStatus`.

Mutation checks (each made the named tests fail, then restored):
- M1 through M7: HEAD version of each source file restored:
  - provider → 3/5 fail
  - asana → 3/5 fail
  - minimax → 2/16 fail
  - jira → 2/14 fail
  - linear → 2/12 fail
  - bridge-config → 2/2 fail
  - ipc/settings → 2/23 fail
- M8: key store writes plaintext when encryption fails → 5/11 fail.
- M9: migration does not drop the settings key → 2/11 fail (primary + new backup contain key).
- M10: migration drops the settings key before persisting → 3/11 fail (lockout).
- M11: HEAD `JarvisSettingsSection.tsx` → 4/4 fail.

Targeted run: jarvis dir, ipc/settings, imessage-bridge, asana, jira, linear, minimax,
communications/providers, and the two renderer settings tests. Result: 378/379 passed. The one
failure is `communications/providers/agent-provider.test.ts` ("No app export on the electron
mock", from agent-runs-store). It is listed in `basefail.txt` and is unrelated.

## Rollback
Revert the commit. Keys already migrated stay in `~/.dobius/elevenlabs-token.enc`, which the
reverted build does not read. Manual re-entry step after a rollback: paste the ElevenLabs key
into Settings > Voice again, or set `ELEVENLABS_API_KEY` in the environment. The other stores keep
their on-disk format (encrypted files unchanged). Session-only values were never written.

## Deviations from EXECUTION-ORDER.md
- Files outside the named list, kept minimal:
  - `jarvis/jarvis-ipc.ts`: migration call, key IPC, key reads for the agent paths.
  - `ipc/settings.ts`: renderer key guard.
  - `preload/index.ts` and `preload/api-types.ts`: 3 methods.
  - `renderer/.../JarvisSettingsSection.tsx`: write-only key field plus a "Remove key" button.
  - `VoicePane.test.tsx`: mock.
  Moving the key out of settings is impossible without these: the renderer read and wrote the
  key through settings. The only visible UI change is the "Remove key" button, needed because an
  empty field can no longer mean "clear".
- Extra scope from the brief: asana, jira, linear and minimax now fail closed (017 had no shared
  helper, so each uses the same local pattern as `openai-api-key-store`).
- The ElevenLabs key file lives in `~/.dobius/` like every other token store, not in userData.

## Known limits
- Jira/Linear/Asana/MiniMax/provider do not report `sessionOnly` to their UIs (no UI change here).
  The value works this session and is not on disk after restart.
- Minimax still reads an existing `plaintext` envelope written by an older build (legacy
  read-only; deleting it would destroy user data).
- A save between Store load and `registerJarvisIpcHandlers` could rotate a backup that still
  contains the key (same content as the pre-existing primary). The migration runs at main-window
  attach, before any renderer can write.
- Windows ACL for the bridge config comes from `writeSecureFile` / `hardenExistingSecureFile`
  (existing shared code); only POSIX modes are tested (the test is skipped on win32).

## Lessons
- `shared/secure-file.ts` already gives atomic, owner-only writes plus re-hardening of old files.
  Reuse it for any file holding personal data.
- Moving a secret out of a renderer-owned settings object needs three things together: a
  main-side guard (`settings:set`), a write-only renderer field, and a migration. Doing only the
  migration lets a stale renderer copy write the key straight back.
