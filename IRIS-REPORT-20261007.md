# Investigation Report: Mobile Phase 1 readiness (phone ↔ desktop over Tailscale)

Target: `/Volumes/Storage/dev/dobius/dobius` on `feat/mobile-app` @ 7196dd82 (v2.0.0). Depth: standard.
Question: how much of Phase 1 of `DobiUS-Mobile-Desktop-Connection-Build-Plan.pdf` (pair over Tailscale; Home → host → worktree → terminal) already exists, and what blocks it?

## Summary
Phase 1 is mostly built already. The mobile app (~77k lines) ships pairing, E2EE transport, host/worktree/session/terminal screens, version gates and Keychain token storage, and the desktop already prefers Tailscale addresses in the QR. The headline gaps are (1) the running desktop app is not listening for phones right now, and (2) the security model is weaker than the plan requires: long-lived bearer QR tokens, a server bound to every network interface, and no terminal input lease.

## Key Findings
1. **The installed desktop is not accepting phone connections.** `Dobius+` (PID 9909, v2.0.0, started 2026-10-07 11:48) listens only on `127.0.0.1:8421`, `:3300`, `:52846`; nothing on `6768`. The code always enables the WebSocket (`src/main/index.ts:2097` `enableWebSocket: true`), but a start failure is logged and swallowed (`src/main/runtime/runtime-rpc.ts` ~line 792–796, "Failed to start WebSocket transport"). No log file was found under `~/Library/Logs`. Severity: **high** (pairing cannot work until this is resolved).
2. **Tailscale is already supported for pairing.** `getNetworkInterfaces()` sorts tailnet addresses first (`src/main/ipc/mobile.ts:31-33`), and the user can pick the address embedded in the QR (`mobile.ts:59-65`). This Mac has tailnet IP `100.94.52.53` and `tailscale` installed. Severity: info (good news).
3. **The pairing QR is a long-lived bearer credential.** The offer carries `endpoint`, `deviceToken`, `publicKeyB64`, `scope`, with no expiry or nonce (`src/shared/pairing.ts:6-16`). Pending tokens are reused until explicitly rotated (`mobile.ts:70-82`, `device-registry.ts:46-65`). Anyone with a screenshot of the QR can pair until it's revoked. The plan requires a "short-lived, single-use challenge". Severity: **medium**.
4. **The server listens on all interfaces, not just Tailscale.** WebSocket binds `0.0.0.0:6768` (`runtime-rpc.ts:29`, `:702`), so it's reachable from any Wi-Fi the Mac joins. It's mitigated by per-device tokens plus app-layer E2EE (`runtime-rpc.ts:697-699`, tweetnacl). The plan says "no public raw execution ports; bind to loopback/tailnet". Severity: **medium**.
5. **The phone gets broad power: 235 allowed RPC methods.** `MOBILE_RPC_METHOD_ALLOWLIST` (`runtime-rpc.ts:120-356`, enforced at `:957`) includes `terminal.send/create/close`, `worktree.rm`, `worktree.forceDeleteBranch`, `ssh.connect`, plus 42 `github.*` and 29 `git.*` methods. The plan asks to "review mutation scope method by method". Severity: **medium**.
6. **There's no terminal input lease (read-only first, then take control).** `src/main/runtime/rpc/methods/terminal.ts` has zero references to lease/controller/read-only; `terminal.send` is directly allowed. The plan's M06/A07 requirement (attach read-only, request control, fencing) isn't implemented. Severity: **medium**.
7. **Revocation works and kills live sessions.** `revokeMobileDevice` removes the device and calls `terminateClientConnections` (`runtime-rpc.ts:467-474`). Severity: info (meets plan).
8. **Phone token storage meets the plan on native.** Uses Expo SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (`mobile/src/transport/host-store.ts:23-24, 41`); AsyncStorage only for the web fallback (`:36-39`). The desktop stores tokens via `writeSecureJsonFile` (`device-registry.ts:27`). Token lookup uses plain `===` (`device-registry.ts:89-90`), which isn't timing-safe. Severity: low.
9. **Version gates are active.** `MOBILE_PROTOCOL_VERSION = 3`, `MIN_COMPATIBLE_DESKTOP_VERSION = 2` (`mobile/src/transport/protocol-version.ts:19-20`), evaluated in `mobile/src/transport/protocol-compat.ts:18-42`. That file is a hand-maintained duplicate of `src/shared/protocol-compat.ts` (comment at `:1-5`), so the two can drift. Severity: low.
10. **Installed and source versions match.** `/Applications/Dobius+.app` reports `2.0.0`, the same as HEAD 7196dd82 (`chore(release): bump version to 2.0.0`). Severity: info.

## Architecture Map
Desktop `DobiusRuntimeRpcServer` (`runtime-rpc.ts`) starts a Unix-socket transport plus an opt-in WebSocket transport. The WebSocket uses a `DeviceRegistry` (per-device tokens, scope `mobile|runtime`) and an E2EE keypair; each socket gets an `E2EEChannel` handshake before any RPC is processed. Settings → Mobile calls `mobile:getPairingQR` (`ipc/mobile.ts`), which mints a pending device token and encodes `dobius://pair?code=…`. The phone scans it (`mobile/app/pair-scan.tsx`), confirms it (`pair-confirm.tsx`), stores the token in the Keychain (`host-store.ts`) and connects via `rpc-client.ts` (reconnect/revival logic plus tests). Requests from `mobile` scope are filtered by the allowlist. Screens: `app/index.tsx` (hosts) → `app/h/[hostId]/index.tsx` (worktrees) → `session/[worktreeId].tsx` (terminal, 5.4k lines) and `tasks.tsx` (15k lines).

## Risk Areas
- A silent WebSocket startup failure makes pairing look broken with no visible error (Finding 1).
- QR replay plus an all-interfaces bind: someone on the same café Wi-Fi with a leaked QR could get full mobile-scope control, including shell input (Findings 3–6).
- Two copies of the protocol-compat logic can drift apart and mis-gate versions (Finding 9).
- `tasks.tsx` at 15k lines and `session/[worktreeId].tsx` at 5.4k lines are hard to change safely.

## Recommendations
1. **Get the desktop listening, then pair the simulator over Tailscale** (`100.94.52.53:6768`). Find out why 6768 isn't open: restart Dobius+ deliberately, or check the console for "Failed to start WebSocket transport". This is the plan's Increment 01 and needs no new code.
2. **Make pairing codes expire and single-use**: add `expiresAt` and a nonce to `PairingOfferSchema` with a v3 offer, keeping v2 compatible as the plan requires.
3. **Bind the WebSocket to the tailnet address (plus loopback) instead of `0.0.0.0`**, behind a setting so LAN pairing can still be opted into.
4. **Add a terminal input lease**: attach read-only, explicit "Take control", epoch fencing on `terminal.send`.
5. **Trim the mobile allowlist** to what Phase 1 screens need, and move destructive methods (`worktree.rm`, `forceDeleteBranch`, git push/merge) behind confirmation or a later phase.
6. Use `crypto.timingSafeEqual` in `validateToken`.

## Open Questions
- Why is port 6768 not open in the running Dobius+? Restarting the app would disrupt open sessions, so it's Carson's call when.
- Should the phone also reach the desktop over home Wi-Fi, or Tailscale only?
- Is the VPS coordinator part of Phase 1, or Phase 2 as the plan says? (Not investigated: no VPS access.)
- Who owns the desktop engine? The plan says "confirm owner collaboration rules in Phase 0", and security changes to `runtime-rpc.ts` touch shared code.
