# REPAIR: voice press runs the wrong engine after a Settings change

## Root cause
`useJarvisVoiceSettings` (dobius/src/renderer/src/components/jarvis/use-jarvis-voice-settings.ts)
reads voice settings once on mount, then only follows `settings:changed`. Main
never sends `settings:changed` to the window that made the change
(dobius/src/main/ipc/settings.ts:81-86, `isOrigin` skip). Settings > Voice lives
in the same main window, so choosing an engine or saving the OpenAI key there
never reaches DictationIndicator / useJarvisTurn. The orb and Cmd+T keep the
engine resolved at launch until a relaunch or reload.

Evidence (isolated copy, commit fdc5ee02, e2e build): engine set to hermes in
the window, then press -> OpenAI Live call path ran (getUserMedia with live
constraints, RTCPeerConnection, main replied "OpenAI Live is not switched on").
After a reload the same press ran a Hermes STT turn. Switching back to
openai-live in the window -> press still ran the Hermes STT turn.

## Change
Also apply `state.settings.voice` from the renderer store (`useAppStore.subscribe`),
which the same-window `updateSettings` writes. IPC path kept for windows
outside <App>.

## Test
use-jarvis-voice-settings.test: render the hook, change the store's
settings.voice to a different engine without any IPC event -> flags follow.
Fails before (flags stay on the mount value), passes after.

## Rollback
`git revert` the single commit on wb/voice-press-fix.
