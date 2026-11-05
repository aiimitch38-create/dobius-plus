# FIXER terminal corruption repair

**Task:** `task_0a6cd6c049b9`  
**Dispatch:** `ctx_4fd2899115b7`  
**Repository:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus`  
**Branch:** `fix/channel-cost`  
**Verdict:** Source regression fixed and focused checks pass; installed and live symptom remain unverified.

## Finding

The source review traced local PTY output through `LocalPtyProvider.onData`, the main IPC batcher, the renderer dispatcher, `pty-connection`, and the xterm write scheduler. Main batches preserve FIFO and report the output sequence when renderer bytes are unchanged. The renderer scheduler flushes queued bytes before an immediate foreground write. Hidden-output recovery already reconciles a sequenced live stream against the main snapshot. The main startup OSC color-query handler is separate from the runtime tail parser; the latter is a read projection and does not feed bytes to xterm.

A different reattach race reproduced actual cell-order corruption. During a reattach, `onData` can deliver fresh shell output before `transport.connect()` resolves. The cold-restore branch then appended saved scrollback to xterm after that fresh output, reversing chronology. The added headless-xterm regression failed before the fix: `fresh shell prompt` occupied row 0 while `restored prior output` occupied row 1, despite the restored text preceding the fresh prompt in the PTY stream.

## Change

Added a reattach output gate with a 2 MiB character cap and a 4,096-chunk cap. For cold-restore-only results, it releases buffered PTY data after replaying historical scrollback and resetting the fresh shell viewport. For snapshot/replay results, it releases data before the result is painted so the authoritative clear-and-replay replaces overlapping output instead of appending it twice. Failed or expired reattach discards buffered data. If the bounded gate overflows, it retains a bounded recent tail, skips cold-restored scrollback, and displays a warning so stale history is not appended after already-visible live output.

The gate does not strip or rewrite terminal control sequences. Buffered chunks return through the ordinary PTY callback, preserving query handling, shell-ready detection, agent status processing, and normal output writes. Two existing status tests now wait for the asynchronous reattach to resolve before asserting that status changes have been processed.

## Frozen files

SHA-256 values below are the exact post-format files used for final validation. `pty-connection.ts` and its existing test were already dirty before this task; unrelated prior changes remain in place.

| File | SHA-256 |
|---|---|
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.ts` | `ab533e1c798424fff17a045919c39eecf9bdcce8401fe4d22253b953e8ba073f` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.test.ts` | `1ddcda476a1847679791d383d554b77c19f4f917ee937411f09a814ed72c5f1d` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.ts` | `c2af11374862ffe3cefe4c48e5bffd88f9ea94346a3c1c0acb6666ae68c9bf48` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts` | `3ca529cda6cb867574fb0a7f22daca721b20a150bc59d152ea77b2a4b801c114` |

## Validation

All Vitest commands used Node `v24.18.0`, the existing dependencies, and `--maxWorkers=1`.

| Command | Result |
|---|---|
| `/Users/bayou/homebrew/opt/node@24/bin/node ./node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/renderer/src/components/terminal-pane/pty-connection.test.ts -t "keeps fresh PTY output after cold-restored scrollback" --maxWorkers=1` before fix | **Expected failure**, demonstrating reversed xterm row order. |
| Same focused command after fix | **PASS**, 1 regression test. |
| `/Users/bayou/homebrew/opt/node@24/bin/node ./node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/renderer/src/components/terminal-pane/pty-connection.test.ts src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts --maxWorkers=1` | **PASS**, 329 tests across 2 files. |
| `/Users/bayou/homebrew/opt/node@24/bin/node ./node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/renderer/src/components/terminal-pane/terminal-capability-replies.test.ts --maxWorkers=1` | **PASS**, 14 tests. |
| `/Users/bayou/homebrew/opt/node@24/bin/node ./node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/main/ipc/pty.test.ts -t "agent startup OSC color queries" --maxWorkers=1` | **PASS**, 2 selected tests. |
| `./node_modules/.bin/oxfmt --write src/renderer/src/components/terminal-pane/pty-connection.ts src/renderer/src/components/terminal-pane/pty-connection.test.ts src/renderer/src/components/terminal-pane/pty-reattach-output-gate.ts src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts` | **PASS**, formatted only the four owned files. |
| `./node_modules/.bin/oxlint src/renderer/src/components/terminal-pane/pty-connection.ts src/renderer/src/components/terminal-pane/pty-connection.test.ts src/renderer/src/components/terminal-pane/pty-reattach-output-gate.ts src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts` | **PASS**, no diagnostics. |
| `/Users/bayou/homebrew/opt/node@24/bin/node ./node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.test.ts --maxWorkers=1` | **FAIL**, 43 passed and 2 unrelated failures. Both existing assertions expect `Dobius skipped hidden terminal output`, while the unchanged scheduler warning contains `Dobius+ skipped hidden terminal output`; neither scheduler file was modified. |

## Limits and next proof

This reproduces and fixes one source-level cold-restore ordering path consistent with overlapping/duplicated terminal text. It does not prove that path caused every screenshot symptom; literal ANSI/cursor fragments may have another cause. The new gate preserves FIFO, bounds retained output, and does not prove live shell-query timing during a slow reattach. Existing startup color-query and renderer capability-reply tests pass, but no real terminal input was sent.

The source has not been packaged or installed. No app or worker was restarted, so no installed or live reproduction/acceptance is claimed. A later safe acceptance step should capture synthetic output sequence/cell state around a real renderer reattach without sending user input, then separately establish whether the literal control fragments reproduce. All unrelated dirty files were preserved; the existing application state remains untouched.
