# TASK-VOICE-4.1 — Review

Re-read every changed file:

- `dobius/src/renderer/src/components/settings/VoiceEngineSection.tsx` + test (new)
- `dobius/src/renderer/src/components/settings/JarvisSettingsSection.tsx` (renders the new section)
- `dobius/src/preload/api-types.ts` (`speech.runBakeoff` type)

## Loop audit result (the "wire the loop" half of the task)

Traced by reading the real call paths, not assumed:

- ⌘T / orb click / wake word → `use-jarvis-turn.ts` → shared speech IPC →
  `stt-service` → `stt-worker` **with VAD endpointing and KWS active** when
  models are present (3.1).
- STT final → `runAskFlow` → `jarvis:ask` → `askBrain` streams sentences
  (2.1) → `speakRouted` → LocalSpeaker → afplay (1.2). Main speaks
  answer/job replies itself; the renderer only speaks error results — the
  pre-existing division, unchanged.
- Orb: renderer sub-phases + main `jarvis:state` broadcasts. Streamed turns
  hold one thinking→speaking→idle arc (asserted by the 2.1 phase test);
  barge-in broadcasts `listening` (3.1).

No new wiring code was needed beyond the settings UI — the seams built in
1.1–3.1 compose into the loop by construction, which was the point of
building them as deps on JarvisService.

## Findings

1. **FOUND — stale `tsconfig.tc.web.tsbuildinfo` served a phantom type
   error.** After adding `runBakeoff` to `api-types.ts`, the web typecheck
   kept reporting the property missing — the incremental build info was
   stale. Deleting `config/tsconfig.tc.web.tsbuildinfo` fixed it with no code
   change. Appended to LESSONS-LEARNED (a wrong-looking type error about a
   just-edited declaration merge → clear the tsbuildinfo before debugging the
   types).
2. **Design — new UI in its own file.** `JarvisSettingsSection.tsx` sits near
   the counted-lines cap; the engine picker went into `VoiceEngineSection.tsx`
   (one-line insertion in the parent), which is also where its test cleanly
   attaches. Spec's "and nothing else" respected: engine picker, local voice
   picker, bake-off button, report path — nothing more.
3. **Checked, OK — bake-off button honesty.** The success toast names the
   winner but the inline report line says to LISTEN before trusting the
   latency winner — same stance as the report itself (1.2).
4. **Checked, OK — no catalog strings added** (plain literals, matching the
   section's existing convention comment).

## Test-proof

Broke the Supertonic button's persist (onClick → no-op) → its test failed;
restored → 5/5.

## Verification

- Scoped suite + the new settings test: **547 passing** (542 + 5), one
  failing file (the known one).
- Both typechecks 0 (after the tsbuildinfo fix); oxlint clean.
- FULL WIRING CHECK over the complete build chain
  (`build:relay` → `build:cli` → `build:electron-vite` → `build:web`):
  results recorded in BUILD-LOG.
