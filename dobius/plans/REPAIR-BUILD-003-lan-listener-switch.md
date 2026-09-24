# REPAIR BUILD-003 — Phone/LAN listener off switch (Upstream)

Bug: N10. `src/main/index.ts` passed `enableWebSocket: true` unconditionally to
`DobiusRuntimeRpcServer`, so every desktop launch bound the runtime RPC
WebSocket on `0.0.0.0:6768` (`runtime-rpc.ts` `host: '0.0.0.0'`, dev 6769).
Any LAN client with a device token could reach `terminal.send`, `git.push`,
`files.*`, `settings.update`. There was no way to turn it off.

## Root cause
The server already supported `enableWebSocket` (constructor default `false`);
only the startup call site hardcoded `true`. Fix at the call site.

## Change
- `src/shared/types.ts`: `GlobalSettings.mobileListenerEnabled?: boolean`
  (optional, like `electronHttp1CompatibilityMode`, so old settings files with
  no key read as off — no migration needed; `=== true` check fails closed).
- `src/shared/constants.ts`: default `mobileListenerEnabled: false` (owner
  decision: OFF until the later security builds / Gate E).
- `src/main/runtime/mobile-listener-setting.ts` (new):
  `shouldEnableRuntimeWebSocket({ settings, isServeMode })` — on only when the
  setting is exactly `true`, or for an explicit `dobius serve` launch
  (`--serve`), whose only purpose is exposing that listener.
- `src/main/index.ts`: passes `shouldEnableRuntimeWebSocket({ settings:
  store.getSettings(), isServeMode })` instead of `true`. Read once at startup;
  a change takes effect on next launch.
- `src/main/runtime/runtime-rpc.ts`: untouched (its default is already off).

## Consumers of the WS server / port 6768 (checked with the switch off)
| Consumer | Behavior when off |
|---|---|
| `ipc/mobile.ts` `mobile:getPairingQR` / `getRuntimePairingUrl` | `createPairingOffer` returns `{available:false}` (no endpoint, no registry) → `{available:false}` |
| `settings/MobilePane.tsx`, `mobile/MobilePage.tsx` | toast "WebSocket transport is not running" (no crash) |
| `settings/RuntimePairingUrlGenerator.tsx` | toast "Runtime pairing is unavailable." |
| `mobile:listDevices` / `listRuntimeAccessGrants` | registry null → empty lists |
| `mobile:revokeDevice` / `revokeRuntimeAccess` | registry null → `{revoked:false}` (tokens unusable anyway while off; the registry file is not touched) |
| `mobile:isWebSocketReady` | `{ready:false, endpoint:null}` |
| Unix-socket RPC + `dobius` CLI (`cli/runtime/transport.ts`, `status.ts`, `metadata.ts`) | uses only `unix`/`named-pipe` transports — unaffected; metadata lists one transport |
| Web client static serving (`webClientRoot`) | served by the WS transport, so also off |
| `dobius serve` (`printServeReady`, recipe JSON) | forced on by `isServeMode` — unchanged |
| SSH relay (`src/relay/*`) | stdio/unix-socket over SSH, never uses 6768 — unaffected |
| E2E (`DOBIUS_E2E_USER_DATA_DIR`, wsPort 0) | no e2e spec depends on the desktop WS (only `computer-cli-driver.ts` spawns `serve`, which stays on) |
| `revokeMobileDevice` → `wsTransport?.terminateClientConnections` | optional chaining, no-op |

## Tests
- `src/main/runtime/mobile-listener-setting.test.ts` (new): helper truth table
  (missing/false/null → off, true → on, serve → on); server with switch off:
  `WebSocketTransport.prototype.start` never called, `wsTransport` null, no
  endpoint, no device registry, pairing unavailable, metadata has only one
  (non-websocket) transport; switch on: start called once, endpoint
  `ws://0.0.0.0:<port>`, pairing available.
- `src/shared/constants.test.ts`: default is `false`.

## Mutation checks (each made the named test fail, then restored)
- A: helper `mobileListenerEnabled === true` → `!== false` (fail-open on a
  missing key): 2 failed — "is off when the setting is missing…" and "creates
  no WebSocket listener when the switch is off".
- B: `runtime-rpc.ts` `if (this.enableWebSocket)` → `if (this.enableWebSocket || true)`:
  1 failed — "creates no WebSocket listener when the switch is off".
- C: default `mobileListenerEnabled: false` → `true`: 1 failed — "keeps the
  phone/LAN runtime listener off by default".

## Deviations from EXECUTION-ORDER.md
- Loopback-only mode (spec test "with it on and loopback-only, binds
  127.0.0.1") SKIPPED. With the owner's decision (off by default, on = today's
  behavior) nothing would select it; exposing it needs an enum setting plus
  pairing-endpoint handling (the QR embeds a LAN address, unreachable from a
  loopback bind) — more than a few lines. `runtime-rpc.ts:701-705` is therefore
  untouched. Candidate for the later Gate E security builds.
- Helper lives in a new small module instead of inline in `index.ts` so the
  startup decision is unit-testable (index.ts cannot be imported in tests).
- No settings UI toggle: every UI string needs entries in 5 locale catalogs
  (`src/renderer/src/i18n/locales/*.json`), so it is not a trivial add.
  Follow-up: add a "Phone listener (takes effect on next launch)" switch in
  `MobileSettingsPane.tsx` and point the "WebSocket transport is not running"
  toasts at it. Until then the only way to turn it on is setting
  `"mobileListenerEnabled": true` in the persisted settings file while the app
  is closed. The runtime `settings.update` RPC cannot set it (its key
  allowlist, `dobius-runtime.ts` `updateClientSettings`, excludes it), so a
  paired phone cannot flip it remotely either.

## Rollback
Revert the commit; phones reconnect on next launch with the old always-on
behavior. The optional setting key left in settings files is inert.

## Lessons
- The server already failed closed (`enableWebSocket = false` default); the
  exposure was one hardcoded literal at the composition root.
