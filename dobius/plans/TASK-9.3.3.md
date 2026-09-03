# TASK-9.3.3 — Permission setup UX v2 (wave-1 slice: signature awareness + re-check + reset)

Part of COMPUTER-USE-V2-PLAN.md (dobius/plans/COMPUTER-USE-V2-PLAN.md). Wave 1. The TCC-identity alignment (9.3.1) is a separate spike/task; this slice is identity-agnostic.

## What
- New main-process module `dobius/src/main/computer/macos-code-signature.ts`: read the helper app's code-signing state (`codesign -dv --verbose=2` on the helper path), return `{ adhoc: boolean, teamId: string | null }`.
- Extend the permission status payload (`src/shared/computer-use-permissions-types.ts`, optional field — backward compatible) so `computerUsePermissions:getStatus` carries signature info.
- Renderer setup dialog ("Enable Dobius+ Computer Use"):
  - When ad-hoc: warning line — "This build is ad-hoc signed; macOS drops Screen Recording/Accessibility grants after every rebuild. Developer ID signing fixes this permanently."
  - "Re-check" button — re-invokes status.
  - "Reset grants" button — calls the existing `computerUsePermissions.reset` IPC, with a confirm.

## Why
Reproduced 2026-08-24: every rebuild silently invalidates TCC grants (ad-hoc signature changes), and the setup UI gives no hint. Users toggle System Settings in circles.

## Where
- `dobius/src/main/computer/macos-code-signature.ts` (NEW — this task owns it)
- `dobius/src/shared/computer-use-permissions-types.ts`
- `dobius/src/main/computer/macos-computer-use-permission-status.ts` (add signature to result)
- `dobius/src/preload/index.ts` + `src/preload/api-types.ts` (permission section only)
- Renderer: the computer-use setup components (search for the "Enable Dobius+ Computer Use" dialog; follow docs/STYLEGUIDE.md tokens; no hardcoded hex colors).

## Test / verify
- Unit: signature parser (fixture `codesign` outputs, adhoc + Developer ID + garbage).
- `pnpm tc` clean outside baseline; scoped vitest for new units.

## Risks
- `codesign` spawn failure (missing binary) → return `adhoc: false, teamId: null` + flag `unknown: true`, never throw.
- Localization catalog gate on new UI strings (pnpm run verify:localization-catalog).

## Estimate
1–2 days.
