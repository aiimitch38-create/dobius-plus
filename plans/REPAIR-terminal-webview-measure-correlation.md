# Repair plan: correlate terminal WebView measurements

## Diagnosis

At `fce5fca4`, `TerminalWebView.tsx` assigns IDs to React Native-to-WebView commands, but the `measure` handler passes only `containerHeight` into the WebView function. `terminal-webview-html.ts` emits `measure-result` without the originating ID, and the React Native handler resolves the one current measure resolver for any result. A second request replaces the first resolver; a delayed result for the first request can therefore resolve the second request with stale dimensions. Iris's deterministic source-model reproduces this control flow. It does not establish that the native bridge reorders messages on a physical device.

Prior context read first: `Dobius Repair Peer Review Queue 2026-10-08.md` and `Handoff Mobile V1 Environment 2026-10-07.md` in Obsidian, plus `IRIS-REPORT-20261008.md` (SHA-256 `a9a0bcb8c79414f6a85c660fd71408d99b3188efc37b478a3c7b43c9d76363d7`). The mobile handoff confirms JS changes flow through Metro and do not require a native rebuild. Follow the already-read `/Users/bayou/.claude/skills/crack_repair/SKILL.md` workflow.

## Intended behavior

- Every measurement command carries the monotonically increasing WebView command ID.
- Every measurement result, including retry exhaustion and invalid/small-width results, echoes that same ID.
- React Native resolves a measurement only when the reply ID matches the active request. Stale or uncorrelated replies are ignored; the active request still settles through its own result, replacement, or timeout.
- Replacing a pending request resolves the superseded promise with `null` and prevents its later timeout or result from affecting the replacement.

## Scope and regression coverage

Expected files:

- `dobius/mobile/src/terminal/TerminalWebView.tsx`
- `dobius/mobile/src/terminal/terminal-webview-html.ts`
- `dobius/mobile/src/terminal/terminal-webview-measure-tracker.ts` and its focused test, to exercise replacement, stale-response rejection, timeout cancellation and cleanup directly.
- `dobius/mobile/src/terminal/terminal-webview-measure-correlation.test.ts`, to execute the actual injected measurement function and assert ID propagation through valid, rejected-width and retry-exhausted results.
- `dobius/mobile/src/terminal/terminal-webview-reflow.test.ts`, whose old exact assertion must expect the correlated null-result shape and command ID.
- This plan.

Tests must prove: an old reply cannot resolve the newest request; a matching latest reply resolves it once; a stale timeout/cancel cannot cancel the latest request; replacing a request resolves the old promise with `null`; and every WebView measurement outcome echoes the ID through normal result, invalid-width, and retry-exhaustion paths. Keep physical bridge-order behavior unclaimed.

No changes to native iOS/Android code, terminal ownership or sizing policy, desktop screen mirror, grants, dependencies, generated artifacts, or live app delivery. Preserve the existing two-second timeout and `null` result semantics.

## Verification and review

Run the focused regression, mobile TypeScript check, scoped Oxlint/Oxfmt, and `git diff --check`. The prior focused Vitest runner fails before collection with Vite OXC `TSCONFIG_ERROR: Tsconfig not found`; record it as a harness limitation and use a direct Node 24 execution of the actual regression logic if it persists. Ask RESEARCH for one independent review of the frozen diff. Commit only this repair's owned files after tests and review pass.

2026-10-08 verification: Node 24 direct source regression exited 0 for tracker stale/current/duplicate/cancel/clear transitions and actual injected WebView valid, narrow-width, and retry-exhausted ID echoes. `pnpm exec tsc --noEmit -p tsconfig.json`, scoped Oxlint, Oxfmt check, and `git diff --check` each exited 0. The focused Vitest command exited 1 before collection with the known OXC `Tsconfig not found` error; no Vitest assertions ran. No phone bridge ordering measurement or install/update was performed.

## Rollback

Revert only this repair's commit if a focused behavior check fails. No install, Metro source switch, or phone update is part of this task; the phone-side physical ordering check remains open for later acceptance.
