# Repair: web preload screen setup API

## Root cause

`PreloadApi.mobile.enableScreenSharing` was added for the desktop settings action,
but `createWebPreloadApi()` does not implement it. The web shim is checked against
`PreloadApi`, so desktop typecheck fails and web callers have no safe unavailable
behavior.

## Files to change

- `dobius/src/renderer/src/web/web-preload-api.ts`
- `dobius/src/renderer/src/web/web-preload-api.test.ts`

## Test to confirm the fix

Add a web preload test that calls the screen setup method and expects a clear
unsupported rejection. It must fail before the shim implementation and pass after.
Then run desktop typecheck and the focused screen safety tests.

## Rollback if wrong

Revert the two-file change if the shim contract or typecheck remains incorrect.
