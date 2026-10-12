# HANDOFF — Dobius Mobile v1 → Carson's iPhone (2026-10-07)

## Current state (the one thing that matters)
The personal development app is installed on the current iPhone and loads JavaScript from Metro at `http://100.94.52.53:8081`. Earlier handoff evidence records successful pairing and terminal input. On 2026-10-07 Codex confirmed Metro responds, desktop Dobius+ listens on 6768, and the daily phone-refresh LaunchAgent is loaded. USB phone detection is pending after the Storage drive briefly disconnected. The refresh agent has not yet performed a real scheduled refresh.

The worktree is `feat/mobile-app` at `0fe8eb32`, matching the installed desktop provenance recorded in the screen handoff. The manual phone install succeeded; the repeatable personal-profile tasks in `plans/MOBILE-V1-ON-PHONE.md` remain unimplemented. Its older device and installation instructions below are historical and superseded by `/Volumes/Storage/dev/codex-runs/HANDOFF-PROMPT-2026-10-07.md`.

Next: save the five existing handoff files, branch to `feat/mobile-desktop-screen`, resolve all 19 screen-review findings, and benchmark capture before feature code. No desktop installation is authorized. Carson must regenerate the pairing code and re-pair because an earlier link was exposed in a chat log.

## Where everything is
- Worktree: `/Volumes/Storage/dev/dobius` (external drive "Storage"), branch `feat/mobile-app`, HEAD `0fe8eb32` (v2.0.0).
- Mobile app: `dobius/mobile` (Expo 55, RN 0.83). node_modules installed. `ios/` generated (git-ignored).
- Plan: `plans/MOBILE-V1-ON-PHONE.md`. Evidence: `IRIS-REPORT-20261007.md`.
- Codex logs/briefs: `/Volumes/Storage/dev/codex-runs/`.
- Do NOT work in `/Users/bayou/Projects (Code)/Dobius/dobius-plus` — it's on `fix/channel-cost` with 11 uncommitted files that aren't ours, and its path breaks the iOS build.

## Verified facts
- The simulator build works from this worktree: "Build Succeeded", app opens on "iPhone 17 Pro" (iOS 26.5) at the "Connect your desktop" screen.
- Build env: `export PATH="$HOME/.gem/ruby/2.6.0/bin:$PATH" LANG=en_US.UTF-8 CI=1` (CocoaPods 1.15.2 via user gems; brew is broken by outdated CLT).
- `~/Library/Developer/Xcode/DerivedData` → symlink to `/Volumes/Storage/dev/xcode-DerivedData`.
- The internal `Projects (Code)` path breaks expo-constants' build script (unquoted parentheses). Always build from the external path.
- Carson has a **free Apple ID only**. Chosen bundle ID: `com.verlosolutions.dobius`. Xcode has no Apple account signed in yet.
- iPhone 14 Pro "Carson (3)", id `3F04E6DF-6F1B-5071-AD77-90AF9FE7CD48`, known to this Mac but currently `unavailable`.
- Mac tailnet IP `100.94.52.53`; Tailscale installed on Mac.
- `mobile/ios/Dobius/Dobius.entitlements` has `aps-environment` (push), which a free Personal Team can't sign. The app uses only local notifications (`mobile/src/notifications/mobile-notifications.ts:62,93,131`).
- Running desktop Dobius+ 2.0.0 is NOT listening on 6768 (only 127.0.0.1:8421/3300/52846). `src/main/index.ts:2097` enables WS; failure is swallowed in `src/main/runtime/runtime-rpc.ts` (~792–796).
- The upstream TestFlight lane (`mobile/fastlane/Fastfile`, `dobius/.github/workflows/mobile-ios-release.yml`) targets the statusdigitalmarketing team; the workflow sits under `dobius/.github`, so GitHub never runs it. Leave it untouched.

## Waiting on Carson (human-only)
1. Xcode → Settings → Accounts → + → Apple ID.
2. Tailscale app on the iPhone, same tailnet.
3. Cable the iPhone in → Trust → Developer Mode on.
4. After the first install: trust the developer profile on the phone.
5. Restart desktop Dobius+ when convenient.

## Next action
Run the Codex prompt (paste-ready in chat / `codex-runs/mobile-v1-brief-v2.md`) after 16:50, or have Claude execute the plan. Then Claude verifies the result and installs to the device once steps 1–4 are done.
