# TASK-VOICE-1.1 — Local TTS engine module

## What

`dobius/src/main/speech/local-tts.ts` + `local-tts.test.ts`: a lazy-loading
wrapper around the sherpa-onnx native addon's offline TTS, with per-engine
model download/extract into `userData/speech-models/<engine dir>`.

## Why

ElevenLabs credits are exhausted; speech synthesis moves on-device. This module
is the engine seam every later task (bake-off, speak routing, barge-in) sits on.

## De-risking done BEFORE this plan (probed against the real addon)

The native addon (`sherpa-onnx-darwin-arm64` v1.12.37, same module stt-worker
loads) was probed directly with `node -e`; validation errors name the exact
config fields, so these shapes are **verified, not guessed**:

- `createOfflineTtsAsync(config)` → Promise of a TTS handle. Config:
  `{ model: { kokoro: { model, voices, tokens, dataDir, dictDir, lexicon, lang }, numThreads, provider, debug }, maxNumSentences }`
  (probe reached `--kokoro-model '/tmp/nope.onnx' does not exist`).
- Supertonic is supported by THIS addon build with fields
  `{ supertonic: { durationPredictor, textEncoder, vectorEstimator, ttsJson, unicodeIndexer, voiceStyle } }`
  (probe reached `--supertonic-duration-predictor ... does not exist`).
- `offlineTtsGenerateAsync(handle, { text, sid, speed, enableExternalBuffer })`
  → Promise `{ samples: Float32Array, sampleRate }` (addon-examples shape;
  final validation happens at bake-off runtime with real models).
- No free/destroy exports exist — handles are napi externals freed on GC, so
  `release()` = drop every reference.

## Design

```ts
export type LocalTtsEngine = 'kokoro' | 'supertonic'
export type TtsAudio = { samples: Float32Array; sampleRate: number }

export type LocalTtsDeps = {
  modelsRoot: string                      // userData/speech-models
  getEngine: () => LocalTtsEngine         // reads voice settings at call time
  loadSherpa?: () => SherpaTtsModule      // default: native addon via sherpa-module-path
  downloadToFile?: (url, dest) => Promise<void>  // default: Electron net.fetch → stream
  extractArchive?: (archive, destDir) => Promise<void>  // default: spawn tar -xjf
}

class LocalTts {
  ensureModel(engine): Promise<string>   // download+extract if missing; ALWAYS rm tarball
  synthesize(text): Promise<TtsAudio>    // lazy-load on first call; reuse handle;
                                         // engine change → release old, load new
  release(): void                        // drop handle refs (rule 8)
}
```

- Model dir layout is INSPECTED at load time (`readdirSync`), not assumed:
  kokoro → `*.onnx` / `voices.bin` / `tokens.txt` / `espeak-ng-data/` /
  `dict/` / `lexicon*.txt`; supertonic → role-matched by filename substring
  (duration→durationPredictor, etc.). Unresolvable role → error listing the
  dir contents.
- Pinned assets (verified against the release 2026-08-29, per AUTONOMOUS-BUILD):
  - kokoro: `.../tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2` (140 MB)
  - supertonic: `.../tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2` (122 MB)
- Extract `getSherpaModulePath()` from `stt-service.ts` into a new shared
  `sherpa-module-path.ts` (reuse over duplication); stt-service delegates.
- Loading + generation both use the async addon variants → the Electron main
  thread never blocks on model load or synthesis.

## Test (fake sherpa factory + temp dirs; no real model, no network)

1. lazy-load-once: two synthesize calls → one createOfflineTtsAsync call.
2. release: release() then synthesize → factory called again.
3. download-skip-when-present: populated model dir → downloader not invoked.
4. tarball cleanup: after ensureModel, the `.tar.bz2` is gone (success AND
   extract-failure paths).
5. engine switch: getEngine flips kokoro→supertonic → old handle dropped,
   second load happens.
6. config building: kokoro dir fixture → config carries inspected paths;
   supertonic fixture → all six roles resolved.

## Verification command

`bash scripts/verify-voice-task.sh 1.1`

## Risks

- generate-call field names unverifiable without a real model → confined to one
  tiny function; bake-off (1.2) exercises it for real.
- stt-service refactor could break its tests → delegation keeps behavior
  byte-identical; scoped suite must stay at 476/1-known-failing.

## Estimate

~250 lines incl. tests.
