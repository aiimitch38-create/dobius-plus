# TASK-VOICE-1.2 — Review

Re-read every changed file:

- `dobius/src/main/speech/tts-bakeoff.ts` + test (new)
- `dobius/src/main/speech/local-tts-speaker.ts` + test (new)
- `dobius/src/main/jarvis/tts-bakeoff-ipc.ts` (new, split out)
- `dobius/src/main/jarvis/jarvis-speak-routing.test.ts` (new)
- `dobius/src/main/jarvis/jarvis-service.ts` (routing)
- `dobius/src/main/jarvis/jarvis-ipc.ts` (localSpeak dep + handler registration)
- `dobius/src/main/speech/speech-runtime-service.ts` (singletons)
- `dobius/src/preload/index.ts`, `src/shared/speech-types.ts`, `src/shared/constants.ts`

## Findings

1. **FIXED — concurrent bake-offs could load two models at once.** A
   double-click on the (future) "run bake-off" button would start two
   handler invocations, each loading engines; two resident models break the
   16 GB budget. Added a module-level in-flight promise — the second caller
   joins the first run instead of starting one.
2. **FIXED (lint-driven) — jarvis-ipc.ts crossed the 300-line cap** (319).
   Split the bake-off handler into `tts-bakeoff-ipc.ts` per the standing
   never-disable-max-lines rule. The split also reads better: the handler has
   its own module doc explaining why it is not in `ipc/speech.ts` (outside the
   build's blast radius).
3. **Checked, OK — existing jarvis-service tests untouched and passing.**
   `localSpeak` is optional with no in-service default, so the old harness
   (speakQueue only, no voiceEngine set) routes local→no-localSpeak→queue
   exactly as before. Rule 7 honored: new routing tests live in a NEW file.
4. **Checked, accepted — concurrent `speak()` calls can overlap audio.** True
   of the ElevenLabs path before this task too (only the huddle queue
   serializes). Parity kept; not this task's scope.
5. **Checked, accepted — playback (not synthesis) failure mid-reply rejects
   and the say fallback restates the reply.** Same behavior as the ElevenLabs
   chain. Synthesis failures after audio started DO keep the played audio
   (tested), matching `speakWithElevenLabs`.
6. **Checked, OK — env hygiene in tests.** The elevenlabs-mode routing test
   stubs `ELEVENLABS_API_KEY`/`_VOICE_ID` to '' so a developer machine with
   real env credentials cannot make the test hit the network.

## Test-proof

Removed `this.generation += 1` from `LocalSpeaker.stop()` → the
stop-flushes-queue test failed (exit 1); restored → green. (Restore was
manual — `git checkout` cannot restore an untracked file; noted for later
proofs on new files.)

## Verification

- Scoped suite: **501 passing** (486 + 15), one failing file (the known one).
- Both typechecks 0; oxlint clean on all touched files after the split.
- WIRING CHECK (post-build): `speech:runBakeoff`, `voiceEngine`,
  `localTtsEngine` all present in `out/` (main + preload). Recorded in
  BUILD-LOG.
