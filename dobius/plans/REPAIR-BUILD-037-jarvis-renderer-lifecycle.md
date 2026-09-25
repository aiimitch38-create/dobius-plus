# REPAIR BUILD-037 — Jarvis renderer lifecycle

Bugs: #82, #83, #88, X7. Branch `stabilize/037-jarvis-renderer-lifecycle` from `stabilize/integration` (5db54ff3).

## Root causes (re-traced 2026-09-24 at 5db54ff3)

- **#82** `useAudioCapture()` returned a fresh object literal every render (`R/hooks/use-audio-capture.ts:286-294`).
  `use-jarvis-turn.ts:51` keeps that object as `capture`, which is a dep of `stopSessionCleanly` (:96-119) and of
  the ambient effect (:285-303). Every re-render (a phase change, a settings push) produced a new
  `stopSessionCleanly`, so the "unmount" effect at :305-318 (`[stopSessionCleanly]`) ran its cleanup: it stopped the
  mic, called `speech.stopDictation` on the live turn and disposed the ambient session. The first `setPhase('listening')`
  alone was enough to kill a turn.
- **#83** `use-voice-agent.ts` `stop()` (:49-57) only closed `conversationRef.current`, which `start()` sets only after
  `await Conversation.startSession(...)` resolves (:84). A stop during the signed-URL fetch (:75), the opening fetch
  (:83) or the SDK connect left `start()` running: it then stored the live session, the SDK's `connected` callback kept
  a paid ElevenLabs call and the mic open while the orb showed idle. Stale SDK callbacks (`disconnected`, `onError`,
  `onModeChange`, `onMessage` → idle timer) could also clobber a later session.
- **#88** `use-jarvis-turn.ts:194-199` set `hudState='error'` with no `errorText` when no STT model is selected, so the
  orb said the generic "Voice error".
- **X7** `R/components/jarvis/OrbView.tsx` mounted a second `useJarvisTurn` (second capture pipeline) for the `#/orb`
  window. The only opener, `openFloatingOrbWindow` (`M/window/floating-orb-window.ts:60`), has no caller: `jarvis:openOrb`
  was already re-pointed to `pressPtt` (`M/jarvis/jarvis-ipc.ts:86-94`) and `orb:close` is not exposed by preload.
  Dead code, so removed rather than fixed.

## Fix

- `use-audio-capture.ts`: return the controls through `useMemo` over the (already stable) callbacks. One place, fixes
  every consumer's deps. DictationController destructures, so it is unaffected.
- `use-voice-agent.ts`: a `generationRef`. `start()` takes a generation; `stop()` bumps it and clears `startingRef`.
  After each await `start()` checks `isCurrent()`; a session that resolves after cancel is `endSession()`-ed and never
  stored. All SDK callbacks and `touchIdle` are no-ops for a stale generation. `finally` only clears `startingRef` for
  the current generation, so a new start after a cancel is not unlocked by the stale one.
- `use-jarvis-turn.ts`: no-model path sets `errorText` to "No speech model selected. Download one in Settings > Voice."
  and shows the same toast + "Open Settings" action (voice pane) that DictationController uses. Capture never opens.
- X7: deleted `OrbView.tsx`, `orb-view.css`, `orb-entry.ts(+test)`, the `#/orb` branch in `main.tsx`, and the dead main
  opener `floating-orb-window.ts` + its registration in `attach-main-window-services.ts`. DictationIndicator's
  `useJarvisTurn` is now the single capture owner.

## Tests

- `R/hooks/use-audio-capture.test.tsx`: controls object identical across re-renders.
- `R/components/jarvis/use-jarvis-turn.test.tsx` (happy-dom, real `useAudioCapture` with fake getUserMedia/AudioContext):
  a listening turn survives settings-driven re-renders (no stopDictation, no track stop); unmount still tears down;
  no model → specific errorText, no getUserMedia/startDictation, toast action opens Settings > Voice.
- `R/components/jarvis/use-voice-agent.test.tsx` (mocked `@elevenlabs/client`, deferred promises): stop during
  signed-URL fetch → no opening fetch, no startSession; stop during SDK connect → late session ended, orb idle, stale
  mode/message callbacks change nothing and arm no idle timer; restart after cancel → stale session ended, fresh one
  kept, stale `disconnected`/`onError` do not reset it.

Mutation checks (each seen failing, then restored and green):
- no `useMemo` → identity test + re-render test fail.
- original `use-voice-agent.ts` → all 3 agent tests fail.
- drop late `endSession` → 2 fail; drop post-signed-URL check → test 1 fails; drop each of the `onModeChange`,
  `onStatusChange`, `onError`, `touchIdle` guards → one test fails each.
- drop the specific `setErrorText` → #88 test fails.

## Deviations from EXECUTION-ORDER.md

- X7 also deletes `M/window/floating-orb-window.ts` and 2 lines in `M/window/attach-main-window-services.ts`
  (outside the named files). Leaving the dead opener would load `#/orb`, which now renders the full App shell.
- Stale comments not touched (other owners' files): `communications/app/router.tsx:7` still mentions `#/orb`,
  `use-jarvis-voice-settings.ts:13` still mentions the orb window.

## Rollback

Revert the commit. No data or settings format changes.

## Lessons

- In zsh, a file list in `$F` is not word-split: `npx oxlint $F` passes one bogus path and prints "No files found".
  Loop per file.

## Verification

- `pnpm run typecheck` exit 0.
- oxlint + react-doctor clean on every changed file. `oxfmt --check` flags two pre-existing long lines in untouched
  code (use-jarvis-turn import, use-voice-agent applySelfEdit call); left alone.
- Targeted vitest (components/jarvis, hooks, components/dictation, main/window): 53 files, 472/474 tests pass.
  - `main/window/attach-main-window-services.test.ts` fails to import (`tear-off-window.ts` needs `BrowserWindow`
    from the test's electron mock). Same failure with this build's two main-side files restored to HEAD: pre-existing.
  - `hooks/agent-hook-completion-notifications.test.ts`: 2 timeouts under the parallel run; 16/16 pass alone. Imports
    nothing touched here.
- Full suite: DEFERRED.
