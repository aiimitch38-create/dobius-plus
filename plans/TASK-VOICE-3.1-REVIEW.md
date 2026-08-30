# TASK-VOICE-3.1 — Review

Re-read every changed file:

- `dobius/src/main/speech/silence-endpointer.ts` + test (new, pure — bundles into the worker)
- `dobius/src/main/speech/vad-endpoint.ts` (new — main-side model fetch/locate)
- `dobius/src/main/speech/wake-kws.ts` + test (new)
- `dobius/src/main/speech/stt-worker-config.ts` (new — extracted + KWS config)
- `dobius/src/main/speech/stt-worker.ts` (VAD/KWS integration)
- `dobius/src/main/speech/stt-service.ts` (`resolveVoiceExtras`)
- `dobius/src/main/speech/local-tts.ts` (exports download/extract for reuse)
- `dobius/src/main/jarvis/barge-in.ts` + test (new)
- `dobius/src/main/jarvis/jarvis-voice-wiring.ts` (new — extracted wiring)
- `dobius/src/main/jarvis/jarvis-service.ts` (`handleBargeIn`)
- `dobius/src/main/jarvis/jarvis-ipc.ts` (wiring call)

## Findings

1. **FIXED — the extras lookup crashed the warm-worker path under the
   injected fake ModelManager.** First integration called
   `this.modelManager.getModelsDir()` unconditionally; stt-service's
   pre-existing tests inject a minimal manager without that method and 13
   tests went red. The right fix matched the feature's own contract — VAD/KWS
   are STRICTLY additive — so the whole lookup moved into
   `resolveVoiceExtras()` with a catch that returns no extras. The
   pre-existing tests pass unmodified.
2. **Architecture — electron kept out of the worker bundle.** The pure
   endpointer originally lived beside the model-download code, which imports
   electron; the worker cannot load electron. Split into
   `silence-endpointer.ts` (zero imports, worker-safe — the module doc says
   why) and `vad-endpoint.ts` (main-side).
3. **Lint-driven splits, no disables.** Touching `stt-worker.ts` (325 lines
   pre-task) tripped the 300-line cap → config building extracted to
   `stt-worker-config.ts` (which the new KWS config wanted anyway).
   `jarvis-ipc.ts` re-crossed the cap → observation wiring extracted to
   `jarvis-voice-wiring.ts`.
4. **Checked, OK — keyword detection resets BOTH streams + the endpointer**
   (fresh turn, drops TTS bleed). Worker `stop` path also resets the
   endpointer so a manual stop cannot leave `heardSpeech` dangling into the
   next session.
5. **Checked, OK — graceful degradation everywhere**: un-encodable keyword →
   `resolveKwsAssets` null → no KWS; VAD/KWS construction failure in the
   worker logs and leaves the feature off rather than posting an error event
   (dictation must not die of an optional feature); first-ever dictation runs
   without models while fire-and-forget ensures fetch them.
6. **Accepted — mic-path behavior is untestable headless.** Config shapes
   were probed against the real addon (silero reached file validation;
   KWS/generate fields dumped from the binary), which retires the config-typo
   risk; live behavior is Carson's first test, per the build file.

## Test-proof

Removed the `isTtsSpeaking` gate from `createBargeIn` → the no-flush-when-idle
test failed; restored → 19/19 green.

## Verification

- Scoped suite: **542 passing** (523 + 19), one failing file (the known one).
- Both typechecks 0; oxlint clean on all touched files.
- WIRING CHECK: post-build grep of `out/main` for `silero_vad_v5`,
  `kws-zipformer-gigaspeech`, `keyword` (in stt-worker.js), and the
  keywords-file name — recorded in BUILD-LOG.
