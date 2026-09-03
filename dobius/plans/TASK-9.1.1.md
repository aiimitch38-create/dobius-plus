# TASK-9.1.1 — `list-screens` + full-display capture

Part of COMPUTER-USE-V2-PLAN.md (dobius/plans/COMPUTER-USE-V2-PLAN.md). Wave 1.

## What
- New CLI: `dobius computer list-screens --json` enumerates connected displays (index, bounds, scale, main flag).
- `dobius computer get-app-state --target screen --screen-index <n>` captures an ENTIRE display instead of one app window (screenshot + display-level info; tree may be empty/omitted for screen targets).
- Capability advertisement: `observation.displayCapture: true` when supported.
- macOS first (ScreenCaptureKit display capture, CG fallback); Linux/Windows parity is a follow-up task, not this one.

## Why
"Full eyes" starts with seeing all monitors. Today observation is per-window only.

## Where
- `dobius/native/computer-use-macos/Sources/DobiusComputerUseMacOS/main.swift` — display enumeration + capture, new request types on the existing socket protocol.
- `dobius/src/shared/computer-use-runtime-types.ts` — capability flag + screen-target types.
- `dobius/src/main/runtime/rpc/methods/` — new computer methods (mirror existing naming).
- `dobius/src/cli/specs/computer.ts`, `dobius/src/cli/handlers/computer.ts` (and `computer-action-flags.ts` if flags shared), `dobius/src/cli/help.ts` — command specs + help lines.
- `dobius/skills/computer-use/SKILL.md` — document the new command.

## Test / verify
- Unit: spec registration (`src/cli/specs/computer.test.ts` pattern), capability serialization.
- Manual (orchestrator runs): `dobius computer list-screens --json` on the live app after rebuild.
- `pnpm tc` shows no errors outside the known baseline set (2 communications/jarvis files).

## Risks
- Retina scale math (action coords vs pixels — reuse existing scale handling).
- 5K payload cap — reuse the downscale path (see runtime.py:581 pattern for the cap message).
- ScreenCaptureKit needs Screen Recording permission — surface the standard permission error, don't crash.

## Estimate
3–4 days solo; wave-1 slice scoped to macOS + CLI + capability flag.
