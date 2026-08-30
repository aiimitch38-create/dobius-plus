# TASK-VOICE-3.1 — VAD endpointing + wake-word barge-in

## What

1. **VAD endpointing** — `dobius/src/main/speech/vad-endpoint.ts`:
   - Pure `createSilenceEndpointer({ silenceWindowS: 0.6 })`: feed
     `{ isSpeech, durationS }` per chunk; `endOfTurn` fires only after speech
     has been seen and trailing NON-SPEECH (per VAD, not per decoder silence)
     accumulates ≥ 0.6s. The win over the old rule: noise no longer holds a
     turn open. 0.6s window kept verbatim from `END_OF_SPEECH_SILENCE_S`.
   - `ensureSileroVadModel(modelsRoot)` downloads the pinned
     `asr-models/silero_vad_v5.onnx` (plain .onnx, ~2 MB, no tarball) if
     absent; `resolveSileroVadModelPath` is a pure existsSync check.
   - Sherpa VAD API verified from the addon binary: config
     `{ sileroVad: { model, threshold, minSilenceDuration, minSpeechDuration, windowSize }, sampleRate, numThreads, provider, debug }`
     (probe reached "Silero vad model file ... does not exist");
     `voiceActivityDetectorAcceptWaveform(vad, Float32Array)` /
     `voiceActivityDetectorIsDetected(vad)`.
2. **Wake-word KWS** — `dobius/src/main/speech/wake-kws.ts`:
   - Asset ENUMERATED (not guessed) via
     `gh api repos/k2-fsa/sherpa-onnx/releases/tags/kws-models`:
     `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2` is the
     English zipformer model. ~15 MB; tarball deleted after extract.
   - Pure `encodeKeywordTokens(word, tokens)`: greedy longest-match over the
     model's `tokens.txt` BPE pieces ('▁ADAM' → e.g. '▁A D AM'), producing
     the keywords-file line `<pieces> @adam`. Unencodable → null (KWS then
     stays off; never a crash).
   - `ensureKwsModel(modelsRoot)` download+extract; `resolveKwsAssets(dir)`
     inspects the extracted dir for encoder/decoder/joiner/tokens.
   - Spotter config fields verified from the addon binary: `keywordsFile`,
     `keywordsScore`, `keywordsThreshold`, `maxActivePaths`,
     `numTrailingBlanks` + featConfig/modelConfig(transducer).
3. **Worker integration** (`stt-worker.ts`, streaming path only):
   - init gains optional `vadModelPath` and `kws { modelDir, files, keywordsFilePath }`.
   - Per feed: KWS stream decodes alongside ASR; a detection posts
     `{ type: 'keyword', keyword }` and resets BOTH the keyword stream and the
     ASR stream (fresh turn — drops TTS bleed captured so far).
   - When VAD is active, end-of-turn = the pure endpointer over
     `voiceActivityDetectorIsDetected`; the old `isEndpoint` path remains the
     no-VAD fallback (and the path existing tests exercise).
4. **Barge-in decision** — `dobius/src/main/jarvis/barge-in.ts`:
   - `createBargeIn({ isTtsSpeaking, stopTts, onBargedIn })`:
     `onKeywordDetected()` → no-op unless TTS is speaking (echo caveat is
     KNOWN: Electron AEC is broken, so interruption is keyword-gated, NOT
     open-mic; do not attempt AEC); else stop (<100 ms — kills the afplay
     child), notify.
   - `tapSttKeywordDetections(stt, onKeyword)` mirrors
     `tapSttFinalTranscripts` (same wrap-startDictation pattern).
5. **Wiring** (stt-service + jarvis-ipc):
   - `SttEvent` union gains `{ type: 'keyword'; keyword?: string }` —
     forwarded to sinks by the existing catch-all `onWorkerMessage`.
   - `startDictation` fire-and-forgets `ensureSileroVadModel` +
     `ensureKwsModel` (in-flight guarded) and passes the assets that ALREADY
     exist — first-ever dictation runs without VAD/KWS while they download
     (graceful degradation, no added start latency), later ones get them.
   - jarvis-ipc: keyword tap → bargeIn (speaker.isSpeaking → speaker.stop() +
     broadcast listening state).

## Tests (all injected/pure; no real models, mic, or network)

- Endpointer: silence-only never fires; speech→0.6s silence fires once;
  noise (isSpeech=true) resets the window; reset() clears.
- Keyword encoding: greedy match on a fixture token set; multi-piece words;
  unencodable → null; keywords-file line format.
- Barge-in: fake KWS detection triggers stop only while speaking (spec's
  three bullets), integrated with the real LocalSpeaker + fake playback to
  prove the queue is emptied and a stopped notification fires.
- Tap: keyword events reach the observer; other events pass through.

## Verification

`bash scripts/verify-voice-task.sh 3.1`. WIRING CHECK: build + grep out/ for
`keyword`, `silero_vad_v5`, `kws-zipformer-gigaspeech` strings.

## Risks

- Worker KWS/VAD paths cannot run against real models headless — mic-path
  features are wired but their first live test is Carson's (stated in the
  definition of done). Config shapes were probed, mitigating the main risk.
- BPE encoding of 'adam' depends on gigaspeech's token inventory; greedy
  matching over single letters always succeeds if letter pieces exist, and
  failure degrades to KWS-off, never a crash.

## Estimate

~520 lines incl. tests.
