# TASK-VOICE-4.1 — Wire the loop + settings UI

## Loop audit (what already connects, verified by reading the real call path)

The end-to-end chain the task names is ALREADY wired by tasks 1.1–3.1 —
this task verifies it and adds the missing UI:

- Wake word / ⌘T → STT: `use-jarvis-turn.ts` (orb click = ⌘T toggle; ambient
  session when wake word on) → shared speech IPC → `stt-service` →
  `stt-worker`, which now carries VAD endpointing (3.1).
- STT final → brain: `runAskFlow` → `jarvis:ask` → `askBrain` (2.1) →
  sentence stream → `speakRouted` → LocalSpeaker → afplay (1.2).
- Orb: local sub-phases plus main's `jarvis:state` broadcasts
  (`onState` listener). Streamed turns hold one thinking→speaking→idle arc
  (2.1); barge-in broadcasts listening (3.1: `handleBargeIn`).

## What this task ADDS

1. `JarvisSettingsSection.tsx`, following the section's existing switch/draft
   patterns, gains EXACTLY (spec: "and nothing else"):
   - Engine picker: ElevenLabs / Local (`voiceEngine`), a two-button segmented
     control.
   - Local voice picker: kokoro / supertonic (`localTtsEngine`), visible in
     local mode.
   - "Run bake-off" button → `window.api.speech.runBakeoff()`; on completion
     surfaces the winner + report path (toast + inline path text). Disabled
     while running (main also guards concurrency, 1.2).
2. Tests: a new `JarvisSettingsSection` voice-engine test file asserting the
   picker persists `voiceEngine`/`localTtsEngine` patches and the bake-off
   button reports the outcome. (Existing section tests, if any, untouched.)
3. Full WIRING CHECK across every channel/setting this BUILD added:
   `speech:runBakeoff` (main+preload+renderer), `voiceEngine`,
   `localTtsEngine` (main+renderer), `keyword` event in stt-worker bundle,
   model asset names in main.

## Verification

`bash scripts/verify-voice-task.sh 4.1` + full build chain + the definition-
of-done sweep (all tasks' plans/reviews, clean tree, HANDOFF).

## Risks

- Renderer test environment: check how sibling settings tests render
  (jsdom + testing-library?) and mirror the closest existing pattern.

## Estimate

~200 lines incl. tests.
