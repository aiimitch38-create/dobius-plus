# Build Plan — Dobius Mobile v1 on Carson's iPhone, with a repeatable update path

Branch: `feat/mobile-app` (worktree `/Volumes/Storage/dev/dobius`). Executor: Codex (`codex exec`), orchestrated by Claude.
Date: 2026-10-07. Source evidence: `IRIS-REPORT-20261007.md` (same folder).

## Goal (definition of done)
1. The current v1 mobile app is installed on Carson's iPhone 14 Pro ("Carson (3)", UDID-ish id `3F04E6DF-6F1B-5071-AD77-90AF9FE7CD48`) under **his own free Apple ID**, bundle ID `com.verlosolutions.dobius`.
2. It pairs with the desktop Dobius+ over Tailscale (Mac tailnet IP `100.94.52.53`) and opens a real terminal.
3. Updating is one command:
   - `pnpm phone:dev` — development build; the phone loads JS live from the Mac's Metro over Tailscale, so every saved edit appears on the phone in seconds.
   - `pnpm phone:release` — standalone build with JS embedded (works without the Mac's Metro); the same command re-signs to reset the free-account 7-day expiry.
4. The upstream/company identity (`com.statusdigitalmarketing.dobius.mobile`, TestFlight lane, push entitlement) is unchanged by default.
5. Tests, typecheck, lint pass; a runbook exists; every task is committed.

## Constraints that shape the design (verified 2026-10-07)
- **Free Apple ID ("Personal Team")**: provisioning profiles expire after 7 days; no push-notification entitlement; max 3 new app IDs per 7 days. The app currently ships `aps-environment` in `mobile/ios/Dobius/Dobius.entitlements`, which a Personal Team cannot sign. The app only uses local notifications (`mobile/src/notifications/mobile-notifications.ts:62,93,131`), so removing `aps-environment` in the personal profile loses no feature.
- `mobile/app.json` hard-codes the upstream bundle ID (line ~"bundleIdentifier"); there is no `app.config.*` yet.
- `mobile/ios/` and `mobile/android/` are generated (git-ignored, `mobile/.gitignore:5-6`); changes must live in config/plugins, not in `ios/`.
- Builds must run from this external-drive path (the internal `Projects (Code)` path breaks expo-constants' unquoted script). CocoaPods comes from user Ruby gems: `export PATH="$HOME/.gem/ruby/2.6.0/bin:$PATH" LANG=en_US.UTF-8`.
- The running desktop Dobius+ v2.0.0 (PID observed 9909) is **not listening on 6768**; `runtime-rpc.ts` swallows WebSocket start failures (~line 792–796). Pairing cannot be verified until this is understood.

## Human steps (Carson — Codex cannot do these)
- **H1** Xcode → Settings → Accounts → **+** → Apple ID → sign in. Note the "Personal Team" Team ID (10 characters).
- **H2** iPhone: install **Tailscale** from the App Store and sign in to the same tailnet as the Mac.
- **H3** Plug the iPhone into the Mac by cable once → tap **Trust**. iPhone Settings → Privacy & Security → **Developer Mode** → On (restarts the phone).
- **H4** After the first install: iPhone Settings → General → VPN & Device Management → your Apple ID → **Trust**.
- **H5** Restart Dobius+ desktop when convenient (needed for Task 2's fix to load and to open port 6768).

## Tasks (Codex)

### Task 1 — Personal iOS profile (config, not generated code)
- Add `mobile/app.config.js` that loads `app.json` and, **only when** `DOBIUS_IOS_PROFILE=personal`:
  - sets `ios.bundleIdentifier` = `DOBIUS_IOS_BUNDLE_ID` (default `com.verlosolutions.dobius`);
  - sets `ios.appleTeamId` = `APPLE_TEAM_ID` when provided;
  - adds a local config plugin `mobile/plugins/ios-personal-team-entitlements.js` that deletes `aps-environment` from the entitlements (`withEntitlementsPlist`).
- Default behavior (env unset) must produce config identical to today's `app.json`.
- Tests (vitest, next to the plugin/config): env unset → upstream bundle ID and entitlement untouched; `personal` → new bundle ID, team ID, no `aps-environment`.
- Verify: `DOBIUS_IOS_PROFILE=personal npx expo config --type introspect` shows the new bundle ID and no `aps-environment`; `npx expo config` without the env shows the upstream bundle ID.

### Task 2 — Make desktop mobile-server failures visible, and find why 6768 is closed
- Investigate why the WebSocket transport is not listening (port conflict, startup order, serve mode, etc.). Use code reading plus a dev run on a free port (`devWsPort`) — do **not** quit or restart the installed `/Applications/Dobius+.app`.
- Record the startup failure in the runtime (e.g. `lastWebSocketError`) and expose it through `mobile:isWebSocketReady` so Settings → Mobile can show "Phone connection is off: <reason>" instead of failing silently. Show it in the existing Settings → Mobile UI.
- Tests for the error-recording path (existing runtime-rpc test patterns).
- If the root cause is a real bug (not just "port was busy at launch"), fix it with a test.

### Task 3 — One-command phone scripts
- `mobile/scripts/phone.mjs` with modes `dev` and `release`, wired as `pnpm phone:dev` / `pnpm phone:release` in `mobile/package.json`.
  - Detect the phone via `xcrun devicectl list devices` (prefer a connected/available iPhone; allow `DOBIUS_IPHONE` override); fail with a clear message naming the H-steps if none is available or no Apple team is signed in.
  - Set `DOBIUS_IOS_PROFILE=personal`, run `expo prebuild --platform ios` only when the bundle ID in `ios/` doesn't match the profile, then `expo run:ios --device <id>` (`--configuration Release` for release).
  - `dev`: set `REACT_NATIVE_PACKAGER_HOSTNAME` to the Mac's tailnet IPv4 (detect `100.64.0.0/10` from interfaces) so the phone reaches Metro over Tailscale anywhere.
  - Preflight: CocoaPods on PATH (user-gem path above), external-drive path has no spaces/parentheses, ≥5 GB free on the build volume.
- Unit tests for the pure helpers (device-list parsing, tailnet-IP detection, path check).

### Task 4 — Runbook
- `mobile/docs/PERSONAL-IPHONE.md`: the H-steps, the two update modes (when to use which), the 7-day refresh, limits of a free account, upgrade path to paid/TestFlight (point at the existing `fastlane/Fastfile` lane), and troubleshooting (device unavailable, untrusted developer, Metro unreachable, port 6768 closed, expo-constants path bug). Plain English. Link it from `mobile/README.md`.

### Task 5 — Verification
- `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test` in `mobile/` → all exit 0. Desktop: run the repo's own typecheck config for any changed `src/main` files (see `dobius/package.json` scripts; do not invent a tsconfig path) and the touched test files.
- Simulator smoke test with the personal profile: `DOBIUS_IOS_PROFILE=personal expo run:ios --device "iPhone 17 Pro"` builds and launches; screenshot via `xcrun simctl io booted screenshot`.
- Device install is verified by Claude after Carson completes H1–H4.

## Guardrails
- Never commit credentials, Team IDs or tokens. Never `git push`. Never touch `main`. Never modify `/Users/bayou/Projects (Code)/...` (the internal checkout has someone's uncommitted work).
- Don't quit, restart or reinstall the running `/Applications/Dobius+.app`.
- Don't change the upstream defaults in `app.json`, `fastlane/`, or `.github/`.
- Don't edit anything under `mobile/ios/` or `mobile/node_modules/` by hand.
- Commit per task: `git add <specific files>`, message `feat(mobile): <task> (MOBILE-V1-ON-PHONE T<n>)`, with trailer `Co-Authored-By: Codex <noreply@openai.com>`. Don't use `--no-verify`.

## Risks
- The free-account 7-day expiry is unavoidable; mitigated by `phone:release` re-signing. The paid program removes it.
- Apple may reject the `100.64.0.0/10` ATS exception key format on device; already present upstream, so watch the first device launch.
- Task 2's root cause may need a desktop restart (H5) to confirm.
