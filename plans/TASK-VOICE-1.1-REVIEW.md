# TASK-VOICE-1.1 — Review

Re-read every changed file after implementation:

- `dobius/src/main/speech/local-tts.ts` (new)
- `dobius/src/main/speech/local-tts.test.ts` (new)
- `dobius/src/main/speech/sherpa-module-path.ts` (new, extracted)
- `dobius/src/main/speech/stt-service.ts` (delegates to the extraction)

## Findings

1. **FIXED — corrupt engine id crashed cryptically.** `ensureModel` indexed
   `LOCAL_TTS_ASSETS[engine]` unguarded; a hand-edited settings file with a bad
   `localTtsEngine` would throw `Cannot read properties of undefined` from
   `asset.dirName` instead of naming the problem. Added an explicit
   `Unknown local TTS engine: <value>` throw.
2. **Checked, OK — release() during in-flight generate.** The native handle is
   held by the closure until `offlineTtsGenerateAsync` resolves, so dropping
   `this.loaded` mid-generate cannot free memory under the native call.
3. **Checked, OK — failed load is not cached.** The `catch` around
   `await loading.handle` nulls `this.loaded` only if it still points at the
   same load, so a concurrent engine switch is not clobbered. Covered by the
   "does not cache a failed load" test.
4. **Checked, OK — stt-service refactor.** `getSherpaModulePath` extraction is
   byte-identical logic; `existsSync` import removed (now unused); stt-service
   tests (15) still pass.

## Test-proof (break the code, watch it fail, restore)

Removed the `rmSync(archivePath, …)` in `ensureModel`'s `finally` →
2 failures (tarball-cleanup success + failure paths). Restored → exit 0.
The cleanup tests fail for the RIGHT reason.

## Verification

- Scoped suite: **486 passing** (baseline 476 + 10 new), exactly one failing
  file, the known `attach-main-window-services.test.ts`.
- Both typechecks exit 0. oxlint clean on all four touched files.
