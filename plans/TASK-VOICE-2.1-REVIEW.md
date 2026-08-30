# TASK-VOICE-2.1 — Review

Re-read every changed file:

- `dobius/src/main/jarvis/sentence-stream.ts` + test (new, pure)
- `dobius/src/main/jarvis/voice-brain.ts` + test (new)
- `dobius/src/main/jarvis/jarvis-ask-brain.test.ts` (new)
- `dobius/src/main/jarvis/jarvis-service.ts` (askBrain + speakRouted split)
- `dobius/src/main/jarvis/elevenlabs-client.ts` (chunkForSpeech → shared boundary)
- `dobius/src/main/jarvis/jarvis-ipc.ts` (brain dep)

## SDK decision (recorded)

The SDK path streams. LIVE smoke test 2026-08-30: one `query()` turn with
`includePartialMessages: true` delivered `stream_event`/`text_delta` messages
and a `success` result; text matched the prompt exactly. First delta at
~23.9s — cold CLI subprocess start, which is the argument for the persistent
warm session this task builds. **No `claude --print` fallback needed.**

## Findings

1. **FOUND BY TEST-PROOF — the splitter suite passed with the whitespace rule
   deleted.** Broke `lastSentenceEnd` (boundary on any '.', no whitespace
   check) and all 9 tests still passed: the trailing-period cases were covered
   by the loop's last-char exclusion, and `splitTerminated`'s own check masked
   the rest. This is the same passes-for-the-wrong-reason failure mode the
   build file warns about (self-edit invariant B). Added the discriminating
   case — a decimal sitting MID-buffer (`pi is 3.14 which is neat`) — verified
   it FAILS on the broken code and passes restored.
2. **Design — one continuous speaking phase.** Extracted `speakRouted` (engine
   routing, no transitions) out of `speak()`, so a streamed turn holds
   thinking → speaking → idle instead of flapping speaking/idle per sentence
   (the orb in 4.1 would blink otherwise). Asserted by the phase-sequence
   test.
3. **Design — partial-audio rule.** Brain death BEFORE any sentence → ADAM
   fallback answers normally. Death AFTER audio played → keep the partial
   answer, no ADAM restatement over spoken audio (mirrors
   `speakWithElevenLabs`'s mid-reply rule). Both tested.
4. **Checked, OK — dead sessions do not zombie.** A stream error disposes the
   session, and the next ask reopens (tested). `close()` failures during
   dispose are tolerated with a why-comment.
5. **Checked, OK — chunkForSpeech refactor is behavior-preserving.** Guard
   `cut < 20` on the period index became `end < 21` on the boundary index
   (same threshold, shifted by one); its three pre-existing tests pass
   unmodified. New behavior gained: newline also counts as a boundary —
   consistent with what the brain speaks.
6. **Checked, OK — no lint suppression added.** The yield-less fake generator
   in the fallback test became a manual iterator instead of an
   `oxlint-disable`.

## Verification

- Scoped suite: **523 passing** (501 + 22), one failing file (the known one).
- Both typechecks 0; oxlint clean on all touched files.
- No new IPC channel or setting key → no WIRING CHECK entry required;
  `jarvis:ask` is reused.
