# Repair plan: phone flicker on active Codex terminal

## Scope

Diagnose the reported flicker on Carson's phone while viewing the manager's actively redrawing Codex terminal. Other phone terminals were reported stable. Compare output activity with the renderer path; do not send input to or otherwise disturb the live manager session. Keep this repair in `fix/phone-orchestrator-flicker` and preserve all terminal ownership/acquisition behavior.

## Diagnosis and current evidence

- The live source comparison is isolated at base `fce5fca4d87304cc49ce6a00dc8a0e7dd2938d05`; source edits remain scoped to the injected keyboard-metrics helper, its assembly point, a focused test, and this plan.
- Read `Dobius Repair Peer Review Queue 2026-10-08.md` and `Handoff Mobile V1 Environment 2026-10-07.md` in Obsidian first. The handoff confirms phone JavaScript is served by Metro and that a JS/WebView fix does not require a native rebuild. The queue explicitly says phone renderer/latency claims require physical evidence.
- Read `/Users/bayou/.claude/skills/crack_repair/SKILL.md`, `dobius/AGENTS.md`, `LESSONS-LEARNED.md`, and `dobius/docs/STYLEGUIDE.md`. Skill workflow: diagnose, plan, minimal fix, verify, review, commit, log. Applicable project instructions require scoped edits and existing patterns.
- Read-only `dobius terminal list --json` metadata showed the affected manager terminal was connected and its `lastOutputAt` was current; BUILD1's connected comparison terminal had been idle for roughly 90 minutes. This supports testing output activity as a differentiator, but does not prove the renderer is the root cause.
- Source trace: session `data` events call `TerminalWebViewHandle.write`; the WebView bridge posts each write separately. In `terminal-webview-html.ts`, writes enter a FIFO and `pumpWrites` serializes asynchronous `term.write` callbacks, but it takes one queued chunk per callback. Resize events with snapshots call `init`, which swaps in a hidden surface until replay drains; ordinary resize events call `term.resize`.
- A second source trace found one concrete high-frequency cost: `attachTermObservers` calls `emitKeyboardAvoidanceMetrics()` after every `onWriteParsed`, even when `cursorY`, `rows`, and `altScreen` are unchanged. The React Native receiver only deduplicates those values after each WebView bridge message has already been delivered. This is unnecessary bridge traffic during output bursts and can trigger parent state updates when cursor metrics move. It is a plausible load contributor, not yet proven to cause the reported physical flicker.
- `/Volumes/Storage/dev/metro.log` was last modified at 11:51:40 EDT, before this active comparison. Safe summary found no current WebView/resize/reflow diagnostics; it is not evidence against a present-day failure.
- Physical flicker has been reported by Carson but has not been independently reproduced or measured by FIXER. No renderer exception, resize loop, context-loss event, or repeated `init` has been observed in current runtime evidence.

## Root cause and diagnosis gate

Confirmed source defect: keyboard cursor metrics are sent once per parsed write rather than once per distinct state. The receiver's value dedupe is too late to prevent bridge traffic. Test this directly under a disposable rapid-output burst, then make the WebView suppress unchanged metric tuples. This is the smallest measured source issue matching the output-activity differentiator. It may reduce rendering-thread load, but the physical flicker root cause remains unconfirmed until Carson rechecks the affected terminal; do not claim the visual symptom fixed from source tests alone. Do not add write batching, alternate-screen suppression, or a WebGL fallback without separate evidence.

## Intended files and regression coverage

Scoped implementation:

- `dobius/mobile/src/terminal/terminal-webview-keyboard-metrics-injected.ts` deduplicates keyboard metrics by cursor row, row count, and alternate-buffer state.
- `dobius/mobile/src/terminal/terminal-webview-html.ts` injects that helper, resets its cache on every `init` so each WebView generation sends fresh initial metrics, and emits metrics after the direct resize message.
- `dobius/mobile/src/terminal/terminal-webview-reflow-injected.ts` emits metrics after a local reflow changes terminal dimensions.
- `dobius/mobile/src/terminal/terminal-webview-output-metrics.test.ts` executes the actual emitter, observer, direct resize, and reflow source in a small harness and checks burst suppression, changed cursor/alternate/row metrics, and reset behavior plus init wiring.

Do not touch RPC ownership, subscription acquisition, desktop screen mirror, native project files, dependencies, or the shared live worktree's unrelated dirty files.

## Verification matrix

| Case | Evidence required |
|---|---|
| Burst output / metric bridge | Extracted actual emitter/observer harness produced 100 duplicate metrics for 100 unchanged writes before the fix and 0 after; changed cursor/alternate metrics, direct resize, local reflow, and post-reset initial metrics propagated once each. |
| Normal scrollback output | Existing WebView routing/reflow behavior remains green. |
| Resize / snapshot reflow | Existing viewport/refit and reflow tests remain green; no unnecessary `init` loop. |
| Transport and ownership | No protocol or acquire changes; focused transport ownership regression remains green if affected files require it. |
| Supported static checks | Node 24 mobile TypeScript, Oxlint, and Oxfmt pass. Focused Vitest could not collect tests because Vite OXC fails to find the existing `tsconfig.json` before test collection; the same corrected multiline actual-source regression was run separately under Node 24 with assertions. |
| Physical phone | Carson/manager verifies the exact active Codex terminal against an idle terminal and records whether flicker remains. Source tests alone do not close this item. |

## Rollback

Keep the repair limited to its focused source/test files. If the regression test or supported checks fail, revert only this repair's changes and re-diagnose once; after two unsuccessful attempts, stop per `crack_repair` instructions. If the test passes but no concrete root cause is demonstrated, do not commit a speculative fix.

## Review and delivery

Re-read every changed line, run `git diff --check`, ask RESEARCH for an independent review once there is a concrete diff, and stage only the files listed above plus this plan. Commit only after focused checks and final review pass. Report exact command results, commit hash if any, and physical validation still owed to manager `term_c372a16a-79df-4020-beb4-569277433f10`.
