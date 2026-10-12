# Repair: screen owner used bearer token as registry ID

## Root cause

The WebSocket RPC layer puts the bearer token in `RpcContext.clientId`, but the
screen owner treats that value as `DeviceEntry.deviceId`. `DeviceRegistry.getDevice`
looks up the stable `deviceId`, so a valid phone with `screen.view` is rejected
before it can inspect capabilities or start a session.

## Files to change

- `dobius/src/main/runtime/rpc/core.ts`
- `dobius/src/main/runtime/rpc/dispatcher.ts`
- `dobius/src/main/runtime/runtime-rpc.ts`
- `dobius/src/main/runtime/rpc/methods/desktop-screen.ts`
- `dobius/src/main/runtime/rpc/desktop-screen-contracts.test.ts`
- `dobius/src/main/runtime/runtime-rpc-desktop-screen.test.ts`

## Test to confirm the fix

Dispatch `screen.capabilities` with different authenticated token and stable
device ID values to a real `ScreenSessionService`. It must succeed when the
stable device ID has `screen.view`, proving the lookup does not use the token.
Also exercise the authenticated WebSocket boundary through the real dispatcher:
capabilities, stream readiness, exact-owner renewal, cross-device/socket denial,
cleanup after grant loss, default-denied grants and expiry despite other RPCs.

## Rollback if wrong

Revert the five-file change and this plan if the dispatcher cannot preserve the
authenticated stable device ID or existing RPC ownership behavior changes.

## Reproduction on resume — 2026-10-08

Restoring the original `deviceId: ctx.clientId` lookup makes the new stable-ID
regression test fail (`ok: false` instead of `ok: true`), exit 1. Restored the
stable device-ID fix afterward. The typed-error fixture also needs the authenticated
stable identity so it reaches the intended endpoint, rather than failing ownership
validation before the error under test. Verification complete: desktop typecheck
exit 0; focused screen/protocol/RPC/web tests 77 passed, exit 0; authenticated
WebSocket boundary tests 3 passed, exit 0; phone typecheck and lint exit 0;
phone suite 1,254 passed, 2 skipped, exit 0; grant fixtures 5 passed, exit 0.
