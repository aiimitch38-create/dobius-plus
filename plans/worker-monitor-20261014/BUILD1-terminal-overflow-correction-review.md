# BUILD1 terminal overflow correction independent review

**Task:** `task_ea7db05a7279`  
**Dispatch:** `ctx_116c372e4279`  
**Repository / branch:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus` / `fix/channel-cost`  
**Verdict:** **CHANGES_REQUIRED**. The corrected overflow path prevents clipped VT output and restores display state from a bounded authoritative snapshot when available, but it drops live terminal query bytes before the response handlers process them. Replaying serialized snapshot data cannot restore those side effects because replay deliberately suppresses query replies.

## Exact reviewed freeze

All five current hashes were recomputed and match `fixer.json#terminal-overflow-correction-resume-20261014` and the author report.

| Path | SHA-256 |
|---|---|
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.ts` | `db6a4e6739412a0ae9052c5ff1533b3b981b19ffb1600592b4549bbcabe9926b` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.ts` | `8c2b198f24ab51a8673ba8352da4776e01bec5a1b14848b48710931304caef72` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts` | `67311fa130226286406929edc48ee3e0a5ebda30b6da8868937e093068ff6021` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.test.ts` | `fdabb6682a774113cab3b524c7f29c83a54266f627a0e8e496a446e1f20749c6` |
| `dobius/src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.test.ts` | `748447eb75bc635b635ef623959c8ca545ca6cd03423086dc363cf6ff4012f55` |


The author report SHA-256 also matches its receipt: `32ed59573557b2bc4daeec638bda0aa1216fa2ff905b233bdd6de2d7d08e4de7`.

## Findings

1. **Overflow can suppress required terminal query replies.** In `pty-reattach-output-gate.ts` (the `didOverflow` branch in `onData`), reaching either cap clears queued chunks and ignores all further PTY bytes until `release()`. The gate wraps `dataCallback` in both reattach call paths (`pty-connection.ts` around lines 5765–5784 and 5960–5980), so dropped query bytes never reach `respondToTerminalPixelSizeQueries(data)` at line 5296 or the xterm parser handlers installed by `installTerminalCapabilityReplyHandlers` (`terminal-capability-replies.ts`). After overflow, recovery calls `applyMainBufferSnapshot`; that writes the serialized screen through `writeReplayData`/`replayIntoTerminal`. Replay intentionally suppresses DA1 and OSC 10/11 replies (`terminal-capability-replies.ts` around lines 124–145), and a serialized screen does not contain the original raw query bytes. Thus a query such as `ESC [ c`, `ESC [ 14 t`, or an OSC color query emitted while the gate is holding output can be lost without a reply; if a query is split across the overflow/release boundary, its prefix is lost and its suffix cannot complete the normal scanner/parser state either. A live TUI waiting on that response can remain stuck even though the visible snapshot was restored.

   **Required correction:** preserve query handling while suppressing unsafe visual bytes, or provide a separately reviewed recovery that safely services complete/split supported query frames without replaying their output into xterm. Add a connection-level overflow regression for at least DA1 and a pixel-size or OSC color query, asserting the expected `transport.sendInput` response exactly once while the clipped display stream remains absent. Include a split-across-chunks case and verify snapshot replay does not add a duplicate response.

2. **Split surrogate accounting is conservative rather than exact.** `utf8ByteLength` is applied independently to each incoming string. For a valid surrogate pair split between callbacks, a trailing high surrogate and leading low surrogate are each charged as three replacement bytes; concatenated they encode as one four-byte code point. For example, `L-4` ASCII bytes followed by the two surrogate halves count as `L+2` and overflow even though the combined UTF-8 stream is exactly `L` bytes. This remains a safe upper bound and does not recreate clipping, but it may trigger needless overflow/snapshot recovery at the cap. Either carry the cross-chunk surrogate state for exact accounting or document this deliberate conservative bound and test its exact-cap behavior.

3. **The frozen candidate fails the canonical renderer TypeScript check.** `runDeferredConnect` is declared `(): void` at `pty-connection.ts:3133`, but its terminal branch returns boolean `true` at line 6158. ROOT’s canonical `config/tsconfig.tc.web.json` check reports `TS2322: boolean is not assignable to void` at that exact location (exit 2, one terminal error). Replace this with a bare `return` if only early exit is intended, or correct the callback/call sites if the boolean is required; then rerun the canonical renderer typecheck on the corrected freeze. The recorded Vitest PASS is not typecheck acceptance.

## Bounded behavior reviewed

- Both restored-session paths install the same output gate. Overflow clears all queued chunks and suppresses later gated data until release; no arbitrary VT suffix is delivered.
- `handleReattachResult` keeps snapshot > replay > cold-restore precedence. On overflow, it uses the existing hidden-output snapshot and sequence reconciliation path when available; live chunks arriving during that async restore are queued and reconciled against snapshot sequence metadata. Existing generation and PTY identity checks guard late snapshots. If the recovery API is unavailable, the source has explicit incomplete-screen warnings; cold-restore overflow separately warns that restored scrollback was skipped.
- The connection-level regression routes overflow through the real connection fixture, captures actual terminal writes and asserts the headless rendered screen shows the authoritative snapshot without clipped `[31m`, old `x` content, or U+FFFD. The additional gate-level headless assertions write a clean fixture snapshot directly, so those alone would not prove gate integration; the connection-level case supplies that integration evidence.
- Normal under-cap history-before-live ordering and snapshot/replay replacement ordering remain intact in the inspected branches. The recovery is shared by local, SSH and mobile-fit paths; mobile fit still prevents desktop resize from overriding its dimensions.

## Validation and limits

I verified the five-file freeze and relied on the recorded Node 24 focused result: 377 tests across the connection, gate and scheduler files passed; recorded scoped format, lint and diff checks also passed. I did not rerun tests or alter source. ROOT also reported the canonical renderer typecheck failure above; there is no compile acceptance for this freeze. This is bounded source review only: no package/install/live PTY/SSH/mobile run, terminal input, screenshot, or lifecycle acceptance was performed, and duplicate Codex/Claude banners remain unproven.
