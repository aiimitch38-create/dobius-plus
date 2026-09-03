# TASK-9.2.1 — `open-app` / `quit-app` / `activate-app`

Part of COMPUTER-USE-V2-PLAN.md (dobius/plans/COMPUTER-USE-V2-PLAN.md). Wave 1.

## What
- `dobius computer open-app --app <name|bundle-id>` — launch any installed app (macOS: NSWorkspace / `open -a` fallback).
- `dobius computer quit-app --app <...>` — graceful quit (NSRunningApplication.terminate; confirm dialogs surface, never auto-clicked).
- `dobius computer activate-app --app <...>` — bring frontmost (`open -a` is the robust path; NSRunningApplication.activate fallback).
- Blocklist enforced: blocked apps return `app_blocked` (reuse the existing blocked-app mechanism — find it in `src/main/computer/` / `macos-app-catalog.ts`).
- Capability: `apps.launch: true` when supported.

## Why
Agents can only talk to RUNNING apps today. "Open any app" is an explicit user ask.

## Where
- `dobius/native/computer-use-macos/Sources/DobiusComputerUseMacOS/main.swift` — launch/quit/activate implementation.
- Same CLI/runtime/spec/help files as TASK-9.1.1 (same owner in wave 1 to keep main.swift single-writer).
- `dobius/skills/computer-use/SKILL.md` — document.

## Test / verify
- Unit: blocklist gating, ambiguous-name error listing candidates.
- Manual (orchestrator): open TextEdit via CLI, assert in `list-apps`, quit, assert gone.
- `pnpm tc` clean outside baseline.

## Risks
- Ambiguous names → error should list candidates (existing `app_not_found` recovery pattern).
- terminate() may raise save dialogs — surface, never auto-confirm.
- Activation from a background helper may be app-dependent — prefer `open -a`, report verification state honestly (existing verified/unverified metadata pattern).

## Estimate
2 days solo; bundled with 9.1.1 in wave 1 (same owner, same files).
