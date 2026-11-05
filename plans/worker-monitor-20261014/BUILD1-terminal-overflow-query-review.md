# BUILD1 terminal overflow query correction independent review

**Task:** `task_5c1893cc3671`  
**Dispatch:** `ctx_23f661efe79f`  
**Repository / branch:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus` / `fix/channel-cost`  
**Verdict:** **CHANGES_REQUIRED**. The supported stateless query path is integrated and the prior compile error and conservative split-surrogate policy are addressed. The scanner does not preserve framing for unsupported or malformed VT sequences across release, so it can expose orphaned suffix bytes; the query callback also lacks a dispose/generation fence.

## Exact reviewed freeze

All seven source/test hashes and the author report hash were independently recomputed and match `fixer.json#terminal-overflow-query-correction-resume-20261014`.

| Path | SHA-256 |
|---|---|
| `plans/worker-monitor-20261014/FIXER-terminal-overflow-query-correction.md` | `5e12ee4d411a17d8cd4f40a7cbbf3b89c2e08969fafc45ffa344b2effb91b872` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.ts` | `eb06ebfdb359b674296630ef6315f307a16a73f6d7410f6e852f281c6009e5c6` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.test.ts` | `760eea9fddc496141e652c5742ffdd8bc1cb694e9613b2cb2000d497e1c11d44` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.ts` | `9d22b03b05bfbb4c17a680478a8fd674963d533245a7ebf4fb9bc68c0df38587` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts` | `61c006b6581270e5119a0fd1fdfaffd928aa49f1c387609a631ee85f6a12e16d` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-query-preserver.ts` | `1b089ba33ea734529fa6548e566a1561b8045873060aeb6efdd48c39aae1eaab` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-query-preserver.test.ts` | `2684b8ee0e939d9d9fa0924acc98513355a62f8e670c8487162f30850e7ff994` |
| `dobius/src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.test.ts` | `748447eb75bc635b635ef623959c8ca545ca6cd03423086dc363cf6ff4012f55` |


## Findings

1. **Unsupported/incomplete VT sequences can leak suffix bytes after release.** `pty-reattach-query-preserver.ts:25-30,43-65` tracks prefixes only for the supported stateless query strings. Other CSI/OSC frames lose candidate state as soon as they differ from those prefixes. For a concrete case, overflow data ending in `ESC [ 6` (a cursor-position query intentionally not synthesized) resets the candidate at `6`; after release, a callback containing `nvisible` sees no pending candidate, returns zero consumed characters, and sends `nvisible` through the ordinary renderer path. The `n` is the suffix of the dropped `CSI 6 n` frame and is displayed as text. A malformed/extended OSC that begins with a recognized query prefix but diverges can similarly consume only its first mismatch character (`continuePendingQuery` returns `index + 1` at lines 78-83) and pass the rest of the orphaned payload/terminator to xterm.

   **Required correction:** maintain a bounded VT framing state for any ESC/CSI/OSC frame whose prefix was dropped, even when the frame is unsupported; answer only exact supported stateless queries, but suppress the whole orphaned frame through its terminator. For an invalid or unterminated frame, fail closed without forwarding its suffix as ordinary text. Add scanner and connection-level regressions for unsupported CSI split through release and malformed OSC with ordinary text after the mismatch; assert no suffix leaks, while following ordinary output is retained.

2. **Overflow query replies are not fenced to the live pane generation.** `pty-connection.ts:5389-5404` creates a local gate whose `onQuery` closure sends DA1/OSC replies or invokes the pixel-size responder without checking `disposed`, the bound PTY ID, or a reattach generation. The gate is not retained or invalidated by `dispose()` (`pty-connection.ts:6278+`); only the general `disposed` flag is set. While a reattach is unresolved, a late callback can cross the buffer cap after the pane binding has been disposed and still run this scanner callback. `transport.sendInput` is independently callable for a still-connected PTY, so the disposed binding can send replies using its stale pane dimensions/theme. Gate `discard()` resets only its query candidate and opens the gate; it is not a closed/stale-callback state.

   **Required correction:** bind the gate/query callback to the active binding/PTY generation, fence replies after disposal or reattach replacement, and ensure late output cannot enter the stale `dataCallback` after discard. Add a deferred-connect disposal regression that overflows after disposal and asserts zero reply/input/output side effects from the stale binding.

## Behavior and evidence that passed bounded review

- The gate uses a 2 MiB UTF-8 accounting limit and 4,096-chunk limit; once overflowed it drops queued visual bytes and keeps scanning later callbacks. Split surrogate accounting intentionally charges each callback independently, so a pair split across callbacks is conservatively counted as two U+FFFD encodings (up to two bytes of early overflow); this is now documented and tested.
- The scanner recognizes only bounded DA1 (`CSI c` / `CSI 0c`), pixel-size (`CSI 14t` / `CSI 16t`) and OSC 10/11 color query frames with BEL/ST terminators. It does not fabricate cursor/state-query results. For supported frames split across overflow/release, it responds once and removes the orphaned continuation while adjusting `rawLength`.
- The connection fixture registers the actual reply-handler callbacks and simulates parser dispatch during snapshot writes; the replay guard suppresses duplicate replies. It asserts once-only DA1, OSC and pixel replies, split pixel completion, absent clipped output, and retained post-query visible text. This is meaningful handler/integration evidence, though parser dispatch is simulated rather than a real xterm parser execution.
- Overflow uses the existing snapshot/sequence-reconciliation path; pending live output during asynchronous recovery follows the shared queue/reconciliation logic. Snapshot/PTY generation checks, cold-restore warning, no-snapshot warning, replay precedence and mobile-fit resize handling remain present in inspected paths.
- The old `runDeferredConnect` void-return error is corrected: its early exit is now bare `return`; `handleReattachResult(): boolean` still returns its boolean contract.

## Validation and limits

Because all seven hashes matched, I relied on the author’s recorded Node 24 focused result: 381 tests across four files passed; scoped canonical renderer typecheck, lint, format and diff checks also passed. I did not rerun tests. This is source-only review; no installed/live PTY, screenshot, terminal input, SSH/mobile runtime or lifecycle acceptance was performed. Duplicate Codex/Claude headers remain unproven, and snapshot recovery still depends on the main-process snapshot API; unavailable recovery warns that the terminal may be incomplete.
