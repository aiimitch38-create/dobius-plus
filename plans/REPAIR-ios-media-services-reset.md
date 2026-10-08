# Repair: recover iOS audio only after media reset user action

Workflow: `crack_repair` diagnose -> plan -> fix -> verify -> review -> commit -> log.

## Diagnosis

`mobile/packages/expo-two-way-audio/ios/AudioEngine.swift` keeps the same `AVAudioEngine`, player node, and session setup after `mediaServicesWereResetNotification`; its handler immediately runs `setup()` and `start()`. The engine configuration observer also starts the engine whenever it observes a stopped engine. The module's `initialize()` returns success without reinitializing when the engine object already exists. `use-mobile-dictation.ts` cancels for ordinary interruption events but does not recognize a media-services reset. Together, the reset path can resume processing without a new user action and keep using audio objects that Apple says to recreate.

Evidence: Iris final report `IRIS-REPORT-20261008.md` (SHA `4ac8eaaf71cc923c96d7f0965fc1c9c4ca14f1006e1a51b9d119606715c9d7a4`); Obsidian `Dobius Repair Peer Review Queue 2026-10-08.md`, “Iris audit result”; BUILD1 read-only qualification (same engine/player reused, session configuration not reapplied, unconditional restart). Duplicate-tap failure is not proven: there is no local `removeTap`, but survival across media reset is unknown. Apple documents that clients should recreate audio objects and restore session category/options/mode after reset, and must wait for user action before resuming processing: [mediaServicesWereResetNotification](https://developer.apple.com/documentation/avfaudio/avaudiosession/mediaservicesweresetnotification), [QA1749](https://developer.apple.com/library/archive/qa/qa1749/).

## Plan

- On reset, stop local processing, clear recording/interruption state, mark the engine as awaiting explicit user action, and notify the dictation hook so it cancels any active server dictation.
- Prevent configuration callbacks, recording toggles, playback, and restart helpers from automatically starting or using the stale engine while recovery is pending.
- On the next explicit dictation start, replace the engine and player objects, reapply session category/options/mode/sample-rate/activation, rebuild the graph and taps once, then start. Keep the recovery gate closed if setup or start fails.
- Preserve the existing interruption-resume behavior outside media-services reset. Do not claim a duplicate-tap crash; replacing objects avoids relying on undocumented tap survival.

Implementation scope: `ios/AudioEngine.swift`, `ios/ExpoTwoWayAudioModule.swift`, `mobile/src/hooks/use-mobile-dictation.ts`, a small pure Swift recovery-gate type and executable regression, and this plan.

## Regression and acceptance

- Compile and run the pure Swift gate regression on macOS: normal state permits existing starts; reset blocks automatic start; failed rebuild remains blocked; successful explicit rebuild clears the gate.
- Run mobile TypeScript tests/typecheck for the interruption event handling.
- Run an iOS simulator/native compile if available, without installing or launching an app. Physical acceptance remains: Settings > Developer > Reset Media Services while dictation is active; verify recording stops and uploads cease, no restart occurs until the user starts dictation again, and the next user start reinitializes capture/playback.
- No physical reset, install, or app launch is authorized in this repair stage. A later iOS build/reinstall is required for the native change to reach a device.

## Rollback

Revert only the reviewed media-services-reset commit. No Android, entitlement, permission, or installed-app changes are in scope.

## Verification status

Diagnosis is confirmed from current source and Apple’s documented reset contract. Implementation now gates automatic starts after reset, cancels active dictation, and recreates the audio engine/player plus session/graph only when `initialize()` is called by a later explicit dictation start.

Verification so far:

- `swiftc ios/MediaServicesResetRecoveryGate.swift tests/MediaServicesResetRecoveryGateTests.swift -o /tmp/dobius-media-services-reset-gate-tests && /tmp/dobius-media-services-reset-gate-tests`: exit 0; reset blocks automatic start, failed recovery remains blocked, successful recovery clears the gate.
- `xcrun --sdk iphoneos swiftc -typecheck -sdk /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS26.5.sdk -target arm64-apple-ios13.4 ios/AudioEngine.swift ios/MediaServicesResetRecoveryGate.swift`: exit 0. It reports the pre-existing `allowBluetooth` deprecation and unused `toggleRecording` result warnings.
- `swiftc -frontend -parse ios/ExpoTwoWayAudioModule.swift`: exit 0 after fixing the optional engine reference in the first-initialize branch. This is syntax parsing only, not a full Expo module typecheck.
- Candidate Vitest 4.1.5 `src/hooks/use-mobile-dictation-source.test.ts`: 1 file, 4 tests passed, including media-reset cancellation wiring.
- Mobile TypeScript `tsc --noEmit -p tsconfig.json`: exit 0.

The Expo module wrapper was not compiled as a complete Xcode target in this environment, and the native behavior has not been exercised on a device or simulator. Physical media reset behavior and duplicate-tap survival remain unverified; duplicate-tap failure remains conditional, not a claimed crash. No install, launch, or push occurred.
