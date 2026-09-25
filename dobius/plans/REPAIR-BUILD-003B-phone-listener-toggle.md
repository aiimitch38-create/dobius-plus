# REPAIR BUILD-003B — Phone listener in-app switch (follow-up to BUILD-003, N10)

BUILD-003 added `GlobalSettings.mobileListenerEnabled` (default off, read once
at startup in `src/main/index.ts` via
`src/main/runtime/mobile-listener-setting.ts`). There was no UI for it: the only
way to turn the phone/LAN listener on was editing the settings file while the
app was closed. With the listener off, Settings > Mobile's "Generate QR Code"
showed a raw "WebSocket transport is not running" toast with no explanation.

## Root cause
Missing UI, not a logic bug: BUILD-003 deferred the switch because every UI
string needs entries in 5 locale catalogs.

## Change
- `src/renderer/src/components/settings/mobile-settings-search.ts`: new
  `getMobileListenerSearchEntry()` (title "Phone Listener (takes effect on next
  launch)", description "Lets phones on your local network connect to Dobius+.
  Changes take effect the next time Dobius+ starts.", search keywords
  listener / local network / lan / phone / websocket), added to
  `getMobileSettingsPaneSearchEntries()` so settings search finds it.
- `MobileSettingsPane.tsx`: new `SearchableSetting` + `SettingsSwitchRow`
  bound to `settings.mobileListenerEnabled === true` (missing key reads off,
  same fail-closed check as main). `onChange` calls the store's
  `updateSettings({ mobileListenerEnabled })`, i.e. the desktop
  `settings:set` IPC path (no allowlist there; the key passes through
  `sanitizeRendererSettingsUpdate` untouched).
- `MobilePane.tsx`: on mount it asks `window.api.mobile.isWebSocketReady()`.
  When the listener is not running it shows an inline notice above the pairing
  controls:
  - setting off: "The phone listener is off, so phones cannot pair or connect.
    Turn on Phone Listener above, then restart Dobius+."
  - setting on but not running yet: "…only starts the next time Dobius+
    launches. Restart Dobius+ to pair a phone."
  When `getPairingQR` returns `available:false`, it re-checks the listener; if
  the listener is off the notice explains it and no toast is shown. If the
  listener IS running (other `available:false` causes: no LAN address,
  unreadable device registry) or the status check fails, the existing
  "WebSocket transport is not running" toast is kept.
- Locale catalogs (`en/es/ja/ko/zh.json`): 9 new keys each. Non-English files
  carry the English text, matching how recent keys were added (e.g.
  `ImessageBridgeSetting.*`, commit f910afc3). Written with
  `JSON.stringify(…, null, 2)` which round-trips the files byte-identically, so
  the diff is only the new keys.
- Remote `settings.update` RPC (`rpc/methods/client-ui.ts` `SettingsUpdate`
  zod `.strict()`) is untouched and still rejects `mobileListenerEnabled`; a
  new test pins that.

## Tests
- `MobileSettingsPane.test.tsx` (new): switch renders off for a missing key,
  on for `true`; clicking calls `updateSettings({ mobileListenerEnabled: true })`
  / `false`; label + next-launch note are shown.
- `MobilePane.test.tsx` (new): listener off → off notice, Generate calls
  `getPairingQR`, re-checks status, no error toast; setting on but not
  running → restart notice; listener running + `available:false` → toast kept,
  no notice.
- `rpc/methods/client-ui.test.ts`: `settings.update { mobileListenerEnabled:
  true }` → `invalid_argument`, `updateClientSettings` not called.

## Mutation checks (each made the named tests fail, then restored)
- A: `MobileSettingsPane` `checked={false}` and `onChange` writes
  `showMobileButton` instead: 3 failed (renders on / saves / turns off).
- B: `MobilePane` toast guard `running !== false && mountedRef.current` →
  `mountedRef.current`: 1 failed ("explains the listener is off instead of
  showing a raw error toast").
- C: `MobilePane` notice condition `listenerRunning === false` → `false`:
  2 failed (off notice, restart notice).
- D: added `mobileListenerEnabled: z.boolean().optional()` to `SettingsUpdate`:
  1 failed ("rejects remote attempts to turn on the phone listener").

## Verification
- `pnpm run typecheck`: exit 0.
- Targeted vitest (`components/settings`, `rpc/methods`, `i18n`,
  `mobile-listener-setting.test.ts`): 132/133 files pass; the one failure is
  `i18n/no-top-level-translate.test.ts` (DestinationsSection.tsx, untouched),
  listed in `basefail.txt`.
- oxlint + react-doctor config: clean on all changed files; oxfmt --check clean.
- `verify-localization-catalog.mjs`: all references resolve; the only parity
  error is pre-existing (`es.json` missing `AsanaPane.autoModeBlockedPaused` /
  `autoModeBlockedUnreadable`, from another build), not from this change.

## Deviations
- Other surfaces that toast when the listener is off (`mobile/MobilePage.tsx`,
  `settings/RuntimePairingUrlGenerator.tsx`) are unchanged: the spec scopes the
  explanation to the Mobile settings pane's pairing/QR controls.
- The Generate button stays enabled while the listener is off (disabling it
  would mean changing `MobileNetworkInterfaceSection` props); clicking it keeps
  the notice and shows no toast.

## Rollback
Revert the commit. The setting key stays inert-but-honored by main; the only
way to set it becomes editing the settings file again.

## Lessons
- `mobile:getPairingQR` returns `available:false` for three different reasons
  (listener off, no LAN address, unreadable device registry); the renderer must
  ask `isWebSocketReady` rather than assume which one.
