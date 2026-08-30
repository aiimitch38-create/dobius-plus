# Dobius+ — Autonomous Build: local voice engine (project "own everything")

You are building the local voice pipeline on branch `feat/adam-voice-control`
in the worktree `/Users/bayou/Projects (Code)/dobius-adam`. Context: the
ElevenLabs subscription is exhausted (4,259 characters remain until Sept 25),
so speech synthesis moves on-device. Where this file names a model or URL, it
was verified against the sherpa-onnx release assets on 2026-08-29.

## Hard rules

1. **Work only in this worktree.** Never touch
   `/Users/bayou/Projects (Code)/Dobius/dobius-plus` — another agent owns it.
2. **Never `git checkout` another branch.** Pinned to `feat/adam-voice-control`.
3. **Do not install into `/Applications/Dobius+.app`.** Build to verify
   compilation only. Carson installs manually.
4. **Never `--no-verify`. Never commit credentials.**
5. **Blast radius** — you may only create/modify files under:
   `dobius/src/main/speech/`, `dobius/src/main/jarvis/`,
   `dobius/src/main/window/`, `dobius/src/renderer/src/components/jarvis/`,
   `dobius/src/renderer/src/components/settings/`, `dobius/src/preload/`,
   `dobius/src/shared/`, `plans/`, `scripts/verify-voice-task.sh`,
   `BUILD-LOG.md`, `HANDOFF.md`, `LESSONS-LEARNED.md`. Anything else: STOP and
   write the blocker to `HANDOFF.md`.
6. **No new native dependencies.** Everything here runs on the sherpa-onnx
   runtime already shipped (`createOfflineTts`, `createVad`, `createKws`,
   `createCircularBuffer` are all exported — verified). Do not add
   onnxruntime-node, do not add any package that needs node-gyp. If a task
   seems to need one, the task is mis-scoped — write the blocker and move on.
7. **Never edit or delete a test you did not write.**
8. **This machine has 16 GB RAM and is under memory pressure.** Voice models
   load LAZILY on first use, never eagerly at app startup, and every loaded
   model must have a release path. An eagerly-loaded 500 MB model is a defect.
9. **Disk is at 8.4 GB free.** Delete model tarballs after extraction. Total
   new model weight on disk must stay under 600 MB.
10. Read `LESSONS-LEARNED.md` first and obey every entry. If verification
    fails twice on one task, append the pattern there before continuing.

## Security invariants (carried over — do not regress)

- The renderer clientTools map must never gain a tool that executes a shell
  command or writes a file. Approval stays in the review window
  (`isReviewWindow` sender check in `jarvis-ipc.ts`).
- Nothing may write into `userData/adam-plugins` (invariant B, tested in
  `shell-tool.test.ts` and `self-edit.test.ts`). Do not weaken those tests.
- The ElevenLabs key lives in settings. Local TTS needs no key — never add a
  key requirement to the local path.

## Environment notes that will bite you

- App source is `dobius/`. Run pnpm commands from there.
- `pgrep`/`pkill`: escape the plus — `Dobius\+`. Unescaped `+` is a regex
  quantifier and NEVER matches. This bit twice today.
- zsh does not word-split unquoted vars. Use `while IFS= read -r`.
- Paths contain spaces and parentheses. Quote everything.
- Typecheck: `npx tsgo --noEmit -p config/tsconfig.node.json` AND
  `-p config/tsconfig.tc.web.json`. Bare tsgo does not work.
- Vitest MUST use `--config config/vitest.config.ts` — without it the 5s
  default timeout makes src/main/window flake (LESSONS 2026-08-29).
- Lint: `npx oxlint <paths>`; suppressions are `oxlint-disable`; never
  disable `max-lines` — split the file.
- Control characters in regexes: build with `String.fromCharCode`, no
  `no-control-regex` suppression.
- `pnpm run build:unpack` needs `rm -rf out dist` first.
- The gate script is yours alone — nothing else runs it concurrently.

## Test baseline (measured 2026-08-29 21:06 on clean HEAD)

Scope: `src/main/jarvis src/main/speech src/main/window
src/renderer/src/components/jarvis`
Baseline: **476 passing, exactly one failing file**
(`attach-main-window-services.test.ts`, pre-existing, not yours). The repo has
566 other failing tests OUTSIDE this scope — they are not your problem, do not
fix them, do not run the broad suite.

## Pinned model assets (verified against the release on 2026-08-29)

From `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/`:
- `kokoro-int8-multi-lang-v1_1.tar.bz2` (140 MB) — quality default
- `sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2` (122 MB) — speed option

From `.../releases/download/asr-models/`:
- `silero_vad_v5.onnx` — voice activity detection

Wake word (KWS): list the assets of the sherpa-onnx `kws-models` release via
`gh api` and use the English zipformer model. Do NOT guess the filename —
enumerate, then download.

Models land in `userData` under `speech-models/` beside the existing parakeet
dir (mirror how `stt-worker.ts` resolves its model path). For unit tests, all
model paths are injected — tests never download or load real models.

## The micro-task cycle — every task

```
PLAN → IMPLEMENT → VERIFY → REVIEW → COMMIT → GATE → LOG
```

- **PLAN**: write `plans/TASK-VOICE-N.N.md` BEFORE code. The `VOICE-`
  namespace is mandatory — `plans/TASK-N.N.md` and `plans/TASK-ADAM-N.N.md`
  are prior builds; overwriting them is destructive.
- **VERIFY**: both typechecks exit 0; scoped vitest (config flag!) at or above
  baseline with only the one known failing file; oxlint clean on touched files.
- **WIRING CHECK**: after any task adding an IPC channel, setting, or tool
  name: `pnpm run build:electron-vite` then grep `out/` for every new string.
  Unit tests cannot catch a channel typo — this can.
- **REVIEW**: re-read every changed file, write
  `plans/TASK-VOICE-N.N-REVIEW.md`, fix at least one real thing. When you add
  a test, prove it: break the code, watch it fail, restore. A test that
  passes for the wrong reason happened TODAY (self-edit invariant B — the
  parent dir did not exist, so refusal came from the wrong check).
- **COMMIT**: specific files, message references TASK-VOICE-N.N.
- **GATE**: `bash scripts/verify-voice-task.sh N.N` must exit 0.
- **LOG**: append `BUILD-LOG.md`, update `HANDOFF.md` immediately.

## Tasks

### TASK-VOICE-1.1 — Local TTS engine module
`dobius/src/main/speech/local-tts.ts` (+ test). Wraps
`createOfflineTts` from sherpa-onnx behind a small interface:
`synthesize(text) -> Promise<{samples: Float32Array, sampleRate: number}>`,
plus `ensureModel(engine)` that downloads+extracts a pinned asset into
`userData/speech-models/<name>` (tarball deleted after extract), and
`release()` that drops the loaded model (rule 8). Engine ids: `kokoro`,
`supertonic`. Model dir layout: read each extracted archive's actual contents
to build the sherpa config (voices file, tokens, etc. differ per family —
inspect, do not assume). Lazy load on first synthesize; loading twice reuses.
Tests use an injected fake sherpa factory — assert lazy-load-once, release,
download-skip-when-present, tarball cleanup. No real model in tests.

### TASK-VOICE-1.2 — Bake-off harness + speak routing
1. `dobius/src/main/speech/tts-bakeoff.ts`: given both engines, synthesize
   three fixed sentences each, measure wall-clock first-synthesis and warm
   latency, write WAVs (`writeWave` export) and a markdown report to
   `userData/speech-models/BAKEOFF.md`. Expose as IPC `speech:runBakeoff`.
   This runs REAL models at runtime for Carson — in tests it is exercised
   with the fake factory only. You cannot listen; Carson judges quality
   later. Pick the DEFAULT engine by measured warm latency at runtime (the
   report records the choice).
2. Add `voiceEngine: 'elevenlabs' | 'local'` to voice settings (default
   `'local'` — the ElevenLabs account is out of credits) plus
   `localTtsEngine: 'kokoro' | 'supertonic'` (default `kokoro`).
3. Route `jarvis:speak` through local TTS when `voiceEngine === 'local'`:
   sentence-chunk with the existing `chunkForSpeech` from
   `elevenlabs-client.ts`, synthesize per chunk, play sequentially. Playback:
   follow how the app already plays ElevenLabs audio; if playback is
   renderer-side, ship samples over IPC and play via WebAudio. Keep the
   `say` fallback on any failure.
Tests: routing decision table (elevenlabs / local / fallback), chunk-order
preservation, bake-off report generation with fakes.

### TASK-VOICE-2.1 — Streaming brain seam
`dobius/src/main/jarvis/voice-brain.ts` (+ test). A persistent, warm
conversation with Claude that yields SENTENCES as they stream:
`ask(utterance) -> AsyncIterable<string>`. Implementation: the app already
packages `@anthropic-ai/claude-agent-sdk` (see
`config/packaged-runtime-node-modules.cjs`) — verify the import works in the
main process; use a persistent session (system prompt = Adam identity, short
answers, no narration, never end on silence) with streaming, cutting at
sentence boundaries (extract the boundary logic shared with
`chunkForSpeech`). If the SDK cannot stream here, fall back to spawning
`claude --print --output-format stream-json` and parsing that stream — test
the SDK first and record the decision in the plan. The sentence-splitter and
pipeline (stream → sentences → TTS queue) are pure and fully tested with an
injected fake token stream. Wire `jarvis:ask` to prefer the brain when
`voiceEngine === 'local'`, keeping the ADAM `/v1/converse` path as fallback.

### TASK-VOICE-3.1 — VAD endpointing + wake-word barge-in
1. `dobius/src/main/speech/vad-endpoint.ts`: wrap `createVad` (silero v5)
   into the STT path so end-of-turn = VAD-silence, replacing the blunt
   silence-only rule in `stt-worker.ts` (keep 0.6s as the VAD silence
   window; the win is that non-speech noise no longer holds a turn open).
   Pure decision logic tested with injected frames.
2. Barge-in, half-duplex: while local TTS is speaking, run `createKws` on
   the mic stream for the keyword "adam"; on detection, flush the TTS queue
   and stop playback immediately (<100 ms), then treat the mic as a fresh
   turn. Echo caveat is KNOWN: Electron AEC is broken and speaker output
   bleeds into the mic — keyword-gated interruption is the designed
   mitigation, NOT open-mic interruption. Do not attempt AEC. Tests: a fake
   KWS stream triggers flush; flush empties the queue and emits a stopped
   event; no flush when TTS idle.

### TASK-VOICE-4.1 — Wire the loop + settings UI
End-to-end wiring: wake word / shortcut → STT (with VAD endpointing) →
voice-brain → sentence stream → local TTS queue → playback, orb reflecting
listening/thinking/speaking, barge-in resetting to listening.
`JarvisSettingsSection.tsx` gains: engine picker (ElevenLabs/local), local
voice picker (kokoro/supertonic + a "run bake-off" button that surfaces the
report path), and nothing else. Full WIRING CHECK for every new channel
added across all tasks (at minimum `speech:runBakeoff`).

## Definition of done

Append to `HANDOFF.md` ONLY when ALL of:
- Every task has `plans/TASK-VOICE-N.N.md` + `-REVIEW.md`.
- Both typechecks exit 0.
- Scoped vitest (with config flag): at least 476 passing plus your new
  tests, exactly one failing file, the known one.
- oxlint clean on every touched file.
- WIRING CHECK passes for every new IPC channel and setting key.
- `rm -rf out dist && pnpm run build:relay && pnpm run build:cli &&
  pnpm run build:electron-vite && pnpm run build:web` exits 0.
- `git status --porcelain` empty; BUILD-LOG entry per task.

Then write, as the last lines of `HANDOFF.md`:

```
VOICE BUILD COMPLETE
Carson must: install manually, run the bake-off from Settings, LISTEN to both
engines, and pick. Mic-path features (VAD endpointing, wake-word barge-in)
are wired but untestable without a microphone — first live test is his.
```
