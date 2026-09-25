# REPAIR BUILD-038 — Jarvis main lifecycle

Bugs: #87, #89, #90, #91, #122-F9. Branch `stabilize/038-jarvis-main-lifecycle` from `stabilize/integration` (b014e8cc).

## Root causes (re-traced 2026-09-25 at b014e8cc)

- **#87** `M/jarvis/agent-context.ts` `loadCommandGroups` did `cachedGroups ??= parseCommandGroups(await runCli(['--help']))`.
  `runCli` resolves `"(failed: …)"` on a spawn error, which parses to an EMPTY set, and `??=` caches it. Every later
  grouped command (`worktree list`, `terminal send`, …) was refused as `"x" is not a dobius command.` until restart.
  A `--help` that exited non-zero was also cached. (`dobius --help` exits 0: `src/cli/index.ts:38-48`.)
- **#89** `M/jarvis/jarvis-ipc.ts` broadcast port picked `BrowserWindow.getFocusedWindow()` first, falling back to
  `getAllWindows()`. Only the app shell mounts the Jarvis controller (`DictationController` → `DictationIndicator` →
  `useJarvisTurn`, `R/App.tsx:186`); the `#/self-edit` window renders only `SelfEditView` (`R/main.tsx:82-93`), as do
  torn-off terminals and the floating phone. With the self-edit window focused, ⌘T's `jarvis:ptt-pressed` went to a
  renderer with no listener and was lost. The `getAllWindows()` fallback could also pick an offscreen/PDF window.
- **#90** `M/jarvis/elevenlabs-client.ts` `speakWithElevenLabs` made a `mkdtempSync(tmpdir()/jarvis-tts-*)` per reply
  and never removed it, on any path.
- **#91** Same function: a later synthesis failure already `break`s, but a failure writing chunk 2 or playing chunk 2
  rejected after chunk 1 had been heard, and `jarvis-service.ts:141-143` then spoke the WHOLE reply with the local
  engine, repeating what was already said.
- **#122-F9** `restorePersistedMode` in `jarvis-ipc.ts` wrote `jarvisEnabled: false` whenever the ⌘T grab failed at
  launch, so the user's switch silently turned itself off whenever another app held ⌘T.

## Fix

- **#87** `execCli` returns `{ ok, output }` (`runCli` keeps returning the text for context building). Discovery is
  cached only when `--help` exited cleanly AND yielded at least one group; otherwise `loadCommandGroups` returns null
  and the next command retries. While discovery is failing, commands other than bare flags are refused with an honest
  "Could not read the dobius command list just now, so nothing was run. Try again in a moment." (fail closed). Retry is
  bounded by the user's own command rate plus the existing 12 s CLI timeout; no timer or TTL added.
- **#89** `pickJarvisTargetWindow(focused, hosts)` now only returns a window from `hosts` (the focused one if it is a
  live host, else the first live host, else null). `registerJarvisIpcHandlers(store, mainWindow)` records the main window
  in module state (re-set on every main-window attach, so macOS re-activation retargets the singleton service's port).
- **#90** `speakWithElevenLabs` uses async `mkdtemp`, and in `finally` waits for the playback chain to settle, then
  `rm -rf`s its own dir. An `rm` failure is logged, never thrown (a throw would trigger the full local replay).
  Covers success, synthesis failure, write failure, playback failure and cancel (afplay killed).
- **#91** The function counts chunks whose playback finished. It rejects only if none did (so the local voice still
  speaks when nothing was heard); after at least one chunk played, any later synthesis/write/playback failure ends
  the reply there with a `console.warn` (error message only, never text). `jarvis-service.ts` needed no change: its
  catch at :141-143 now only runs when nothing was heard.
- **#122-F9** `restorePersistedMode` no longer persists `false`; it logs a warning. `toggle(true)` already broadcast the
  `error / global-shortcut-unavailable` state and `jarvis:status` reports `shortcutActive: false`, which the existing
  Settings banner (`R/components/settings/JarvisSettingsSection.tsx:249-255`) shows. Toggling off and on retries.

Test seams: `speakWithElevenLabs(text, config, io?)` takes an optional `ElevenLabsSpeechIo`
(`synthesize`/`write`/`play`/`tempRoot`); production callers pass nothing.

## Tests

- `M/jarvis/agent-context-discovery.test.ts` (mocked `node:child_process`, fresh module per test): failed help not
  cached, next command retries and runs; non-zero-exit help not cached; successful help cached once; unknown group
  still refused.
- `M/jarvis/elevenlabs-speech-lifecycle.test.ts` (temp root under os tmpdir): no leftover dir on success, first
  synthesis failure, cancel (afplay killed), and every #91 path; file still present while "afplay" plays it; second
  synthesis / second write / second playback failure resolve (no replay) after one chunk played; first-chunk playback
  failure still rejects.
- `M/jarvis/jarvis-target-window.test.ts`: focused self-edit window not a host → main; only host destroyed → null.
- `M/jarvis/jarvis-ipc.test.ts` (mocked electron + key store + self-edit window): refused grab at launch → no
  `updateSettings`, `jarvis:status` false, error state sent to main; free grab → active, no write; ⌘T handler with the
  self-edit window focused → `jarvis:ptt-pressed` reaches main only.

Mutation checks (each seen failing, then restored and green):
- M1 cache empty discovery (drop `groups.size === 0` guard) → 2 discovery tests fail.
- M1b ignore `help.ok` → non-zero-exit test fails.
- M2 drop `rm` → all 8 lifecycle tests fail.
- M3 always rethrow → 4 tests fail (the three #91 paths + still-playing).
- M4 remove both "wait for playback" awaits → 2 fail.
- M5 put back `persistVoicePatch(store, { jarvisEnabled: false })` → F9 test fails.
- M6 old focused-first picker → 3 tests fail (2 picker + ipc routing).

## Deviations from EXECUTION-ORDER.md

- `M/window/attach-main-window-services.ts` (outside the named files): one line, passes `mainWindow` to
  `registerJarvisIpcHandlers` so the broadcast port knows which window hosts the controller.
- `M/jarvis/jarvis-service.ts:143` unchanged: fixing the client's reject contract removes the replay at its source.
- "Cancel": main has no TTS cancel API; cancel = the afplay process being killed, which reaches the same cleanup path.
  A hard app kill mid-reply can still leave one `jarvis-tts-*` dir in the OS temp folder (no finally runs); not swept.
- `jarvis-ipc.ts:158-161` keeps a pre-existing misplaced "Why exposed" comment (not this build's lines).

## Rollback

Revert the commit. No settings or data format change.

## Lessons

- `oxlint` (consistent-type-imports) rejects `typeof import('./x')` annotations in tests; use `import type * as X`.

## Verification

- `pnpm run typecheck` exit 0.
- oxlint and react-doctor clean on all changed files.
- Targeted vitest `src/main/jarvis src/main/window`: 28/29 files, 285/285 tests pass. The one failing file,
  `attach-main-window-services.test.ts`, fails at import (electron mock lacks `BrowserWindow`) and is in basefail.txt.

## Review follow-up (F1)

- Problem: the boot-time `jarvis:state` error is broadcast before React listens, and `use-jarvis-turn` never shows a
  reason, so a refused launch grab was visible only in Settings.
- Fix: `R/components/jarvis/use-jarvis-turn.ts` asks `jarvis.status()` once (ref-guarded; no cleanup cancel, so the
  StrictMode re-run cannot skip it) the first time `jarvisEnabled` is true. If `shortcutActive` is false it toasts
  "Jarvis shortcut (Cmd+T) couldn't be registered. Another app may be using it. See Settings > Voice." with the same
  Open Settings (voice pane) action as the no-model toast, now shared as `OPEN_VOICE_SETTINGS_ACTION`. The file uses plain
  strings (no i18n), so no locale files were touched. Corrected the `restorePersistedMode` comment in `jarvis-ipc.ts`.
- Tests (`use-jarvis-turn.test.tsx`): toasts once and the action opens Settings > Voice; quiet when held; no status
  toast while Jarvis is off. Mutation: drop the toast → the first test fails; restored → green.
- Verification after merging `stabilize/integration`: typecheck exit 0; oxlint + react-doctor clean; targeted vitest
  (main/jarvis, main/window, components/jarvis, components/dictation) 334/334 tests, 38/39 files (the baseline
  attach-main-window-services import failure).
