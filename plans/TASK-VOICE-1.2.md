# TASK-VOICE-1.2 — Bake-off harness + speak routing

## What

1. `dobius/src/main/speech/tts-bakeoff.ts` (+test) — synthesize three fixed
   sentences on each engine, time cold (first synth incl. model load) and warm
   latency, write WAVs + `userData/speech-models/BAKEOFF.md`, pick the default
   engine by measured warm latency. Engines run SEQUENTIALLY and each is
   `release()`d before the next loads (16 GB rule — never both in memory).
2. `dobius/src/main/speech/local-tts-speaker.ts` (+test) — chunk via the
   existing `chunkForSpeech`, synthesize per chunk, `writeWave` to a temp dir,
   play sequentially via afplay (same pattern as `speakWithElevenLabs`:
   next chunk synthesizes while the current one plays). Has `stop()` — kills
   the current afplay child and drops queued chunks — because 3.1's barge-in
   needs a flush path; a killed playback resolves cleanly, it does not reject.
3. Settings: `voiceEngine: 'elevenlabs' | 'local'` (default `'local'` — the
   ElevenLabs account is out of credits) and
   `localTtsEngine: 'kokoro' | 'supertonic'` (default `'kokoro'`) in
   `shared/speech-types.ts` + `shared/constants.ts`. `LocalTtsEngine` and the
   bake-off result types move to shared so preload can type the new channel
   without importing main code.
4. `jarvis-service.speak` routing (decision table):
   - `voiceEngine === 'elevenlabs'` → ElevenLabs when config resolves; failure
     or missing config → `say` fallback (huddle queue). No cross-fall to local.
   - `voiceEngine === 'local'` (default) → `deps.localSpeak` when provided;
     failure or absence → `say` fallback.
   - `localSpeak` is an OPTIONAL dep with NO in-service default: production
     wiring (jarvis-ipc) supplies the real LocalSpeaker; the existing
     jarvis-service tests (which inject only `speakQueue`) keep passing
     untouched (rule 7: never edit a test I did not write — new routing tests
     go in a NEW file `jarvis-speak-routing.test.ts`).
5. IPC `speech:runBakeoff` — registered in **`jarvis-ipc.ts`**, NOT
   `src/main/ipc/speech.ts`, because that file is outside this build's blast
   radius. Handler runs the bake-off with real deps and persists the winner to
   `localTtsEngine` (Carson can override in Settings; the report records the
   choice and tells him to listen). Preload gains `speech.runBakeoff`.
6. Singletons `getLocalTts(store)` / `getLocalSpeaker(store)` in
   `speech-runtime-service.ts`; modelsRoot reuses
   `getSpeechModelManager(store).getModelsDir()` (inherits the prepared/
   migrated cache dir).

## Probed facts carried in

- `writeWave(filename, { samples, sampleRate })` verified against the real
  addon (wrote /tmp/probe-wave.wav).

## Tests (all with fakes; no real models, no audio device)

- Bake-off: winner by lower warm average; per-engine release() called and
  engines created sequentially; one engine failing → error recorded, other
  wins; BAKEOFF.md written with winner + wav paths.
- Speaker: chunk order preserved in playback; stop() prevents further
  playback and kills the current one; first-chunk synth failure rejects,
  later-chunk failure keeps already-queued audio (parity with ElevenLabs).
- Routing decision table (new file): local+localSpeak → localSpeak, no queue;
  localSpeak throws → queue fallback; elevenlabs mode ignores localSpeak;
  local mode without localSpeak → queue.

## Verification

`bash scripts/verify-voice-task.sh 1.2` + WIRING CHECK: build, grep `out/`
for `speech:runBakeoff`, `voiceEngine`, `localTtsEngine`.

## Risks

- afplay is macOS-only; parity with the existing ElevenLabs playback (also
  afplay-only) — the `say`-queue fallback covers other platforms, unchanged.
- Real bake-off latency/quality unverifiable headless; Carson runs it and
  listens (spec explicitly assigns this to him).

## Estimate

~420 lines incl. tests.
