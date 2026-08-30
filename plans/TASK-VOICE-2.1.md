# TASK-VOICE-2.1 — Streaming brain seam

## What

`dobius/src/main/jarvis/voice-brain.ts` (+ tests) — a persistent, warm Claude
conversation that yields SENTENCES as they stream:
`ask(utterance) -> AsyncIterable<string>`. Plus a pure sentence-boundary
module shared with `chunkForSpeech`, and `jarvis:ask` preferring the brain
when `voiceEngine === 'local'` (ADAM `/v1/converse` stays the fallback).

## SDK decision (recorded per the build file)

**The SDK path works — no `claude --print` fallback needed.** Verified before
this plan:

- `require('@anthropic-ai/claude-agent-sdk')` resolves and exports `query`
  in this repo's runtime (probed with plain `node -e`; Electron main is the
  same Node runtime). The package and its darwin-arm64 sidecar are both in
  `config/packaged-runtime-node-modules.cjs`, so the packaged app ships them.
- Streaming shape confirmed from `sdk.d.ts` (not guessed):
  `query({ prompt: AsyncIterable<SDKUserMessage>, options })` returns an
  async-iterable `Query` with `.close()`; `includePartialMessages: true`
  emits `{ type: 'stream_event', event: BetaRawMessageStreamEvent }` whose
  `content_block_delta`/`text_delta` events carry incremental text; each turn
  ends with a `{ type: 'result' }` message.
- A one-shot LIVE streaming smoke test runs during this task (maxTurns-capped,
  a one-line prompt) to prove end-to-end streaming before wiring; its outcome
  is recorded in the review doc. Unit tests use a fake message stream only.

## Design

1. `dobius/src/main/jarvis/sentence-stream.ts` — PURE:
   - `findSentenceBoundary(text)` extracted so `chunkForSpeech` and the
     splitter share one definition of "sentence end" ('. ', '! ', '? ',
     newline; trailing flush).
   - `createSentenceSplitter()` → `{ push(delta): string[]; flush(): string | null }`.
   - `elevenlabs-client.ts` refactored to use it (behavior identical; its
     existing tests must not change).
2. `voice-brain.ts`:
   - `VoiceBrain` holds ONE streaming-input query (async queue of
     SDKUserMessages) opened lazily on first ask — warm across turns.
   - `ask(utterance)` pushes a user message, consumes messages until the
     turn's `result`, yields sentences from text deltas via the splitter.
   - System prompt: Adam identity — short spoken answers, no narration, no
     markdown, never end on silence.
   - `allowedTools: []` and `maxTurns: 1` per ask — the brain TALKS; acting
     stays with the existing ADAM tool path.
   - Serialized: one ask at a time (a second ask awaits the first turn's end;
     the pipe would interleave sentences otherwise).
   - Failure or SDK unavailability → throw; caller falls back to ADAM.
   - `dispose()` closes the query.
   - Deps injected: `openQuery` (default wraps the real SDK) so tests drive a
     fake token stream.
3. `jarvis-service.ask`: when `voiceEngine !== 'elevenlabs'` and a brain dep
   is wired, stream brain sentences through `speak` per sentence (TTS queue
   overlap comes from LocalSpeaker); on brain error fall back to the existing
   `converseWithAdam` path unchanged. Brain dep optional like `localSpeak` —
   existing tests keep passing; new tests in a new file.

## Tests (fake streams only)

- Splitter: deltas split mid-sentence/multi-sentence/abbreviation-ish cases;
  flush yields the tail; chunkForSpeech parity (its tests still green).
- Brain: fake stream yields sentences in order as deltas arrive; turn ends on
  result; second ask reuses the same query (warm); error propagates; dispose
  closes; serialization (second ask waits).
- jarvis-ask routing: brain preferred in local mode, sentences spoken in
  order; brain failure → ADAM fallback speaks; elevenlabs mode → ADAM path
  untouched.

## Verification

`bash scripts/verify-voice-task.sh 2.1`; live smoke test result recorded in
review; WIRING CHECK not needed (no new IPC channel — jarvis:ask reused) but
build must still pass.

## Risks

- SDK auth: the packaged runtime uses Carson's existing `~/.claude` login;
  if headless auth fails the brain throws and ADAM fallback covers it — the
  smoke test tells us now rather than at first live use.
- Token cost of the smoke test: one minimal turn, accepted.

## Estimate

~380 lines incl. tests.
