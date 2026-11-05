# BUILD1 terminal reattach chronology independent review

**Task:** `task_c02a299323c1`  
**Dispatch:** `ctx_1d5ba0bb0bea`  
**Repository / branch:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus` / `fix/channel-cost`  
**Verdict:** **CHANGES_REQUIRED** for the frozen source packet. The cold-restore chronology correction is wired into both reattach paths, but its overflow handling can emit a truncated ANSI control sequence as visible terminal text.

## Exact reviewed freeze

The four hashes below were recomputed from the current canonical worktree and match `fixer.json#terminal-corruption-repair-resume-20261014` exactly.

| File | SHA-256 |
|---|---|
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.ts` | `ab533e1c798424fff17a045919c39eecf9bdcce8401fe4d22253b953e8ba073f` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.test.ts` | `1ddcda476a1847679791d383d554b77c19f4f917ee937411f09a814ed72c5f1d` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.ts` | `c2af11374862ffe3cefe4c48e5bffd88f9ea94346a3c1c0acb6666ae68c9bf48` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts` | `3ca529cda6cb867574fb0a7f22daca721b20a150bc59d152ea77b2a4b801c114` |

## Review findings

1. **Overflow can release malformed terminal control bytes.** In `pty-reattach-output-gate.ts:45,52-61`, the gate enforces its cap with arbitrary `String.slice()` boundaries, both within an incoming chunk and across the oldest buffered chunk. It has no CSI/OSC or UTF-16 boundary tracking. For example, let `L = 2 * 1024 * 1024` and buffer `'xx\x1b[' + 'A'.repeat(L - 1)`: the input is `L + 3` UTF-16 code units, so the incoming-chunk suffix starts at index 3, dropping both `x` characters and ESC while retaining a bare `[` plus following bytes. The dropped ESC makes that suffix ordinary text when the gate releases. A split OSC can similarly leave its tail/terminator visible; a boundary may also split a surrogate pair. The gate’s direct test only checks plain ASCII tail retention and does not exercise these cases. This is especially material because the reported user symptoms include literal ANSI fragments.

   **Required correction:** make overflow release parser-safe (preserve an explicitly validated sequence boundary and Unicode scalar boundary), or fail closed by discarding the unverifiable pending tail and performing an explicit safe parser resynchronization before subsequent live bytes. Do not release arbitrary truncated chunks. Add deterministic CSI, OSC, and surrogate-boundary regressions, including overflow across multiple chunks, and verify no fragments or duplicates reach xterm.

2. **The stated 2 MiB bound is a character/code-unit limit, not a byte limit.** `bufferedChars` and both caps count JavaScript string `.length`, so the packet’s “2 MiB” description does not establish a 2 MiB payload memory ceiling (and up to 4 MiB of UTF-16 code-unit storage is possible before chunk/object overhead). Clarify the cap contract and enforce a byte budget if the stated bound is intended to be bytes.

## Bounded evidence that passed review

- The same gate is connected in both restored-session paths (`pty-connection.ts` around lines 5748–5821 and 5943–6008). Both discard on rejected/expired/error paths and route released chunks through the normal `dataCallback`.
- `handleReattachResult` makes the intended snapshot > replay > cold-restore choice. Snapshot/replay release buffered live output before clear-and-replay; cold-restore writes restored scrollback and reset/viewport data before releasing queued PTY output. Replay writes use `replayIntoTerminal`, whose guard is intended to suppress xterm auto-replies; released gate bytes use the live callback, preserving ordinary query handling.
- The frozen regression covers the reproduced early-live-before-cold-restore ordering race. The test suite does not prove screenshot-wide causality or the overflow/control-sequence boundary behavior above.
- The source hashes match the author's frozen validation packet. I relied on its recorded Node 24 evidence: 329 connection/gate tests, 14 capability reply tests and 2 selected startup-query tests passed; the unrelated scheduler warning-name suite was reported as 43 passed / 2 stale assertions. I did not rerun tests because this is a source-only review and the missing cases require a corrected candidate.

## Limits

This review does not claim that the reported screenshots are fully explained or fixed, and it does not establish installed/live behavior. Literal ANSI symptoms remain unverified outside the concrete source-level overflow risk described above. No source, runtime, terminal input, package, service, private account/profile/configuration, or Git state was changed.
