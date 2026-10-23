# FIXER terminal ANSI follow-up

Task `task_25f1dc2c0ca3`, dispatch `ctx_312f7964a3fa`  
Repository: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`  
Branch: `fix/channel-cost`

## Result

The two scheduler failures were stale expected strings. I changed only the assertions to match the existing `Dobius+ skipped hidden terminal output` source text, preserving the behavioral checks; the focused scheduler suite passes 45/45 under Node 24.

The remaining ANSI display symptom has a reproducible source path in the already reviewed reattach freeze. The bounded gate can cut through an escape sequence when retaining a tail, and xterm-headless then renders the remaining parameter bytes as text. I did not alter any of the four frozen files; this requires a routed follow-up review before changing that freeze. The reported duplicated Codex/Claude headers are not reproduced by this work.

## Scheduler correction

Owned edit: `dobius/src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.test.ts` (two expected-string corrections).  
SHA256 after edit: `748447eb75bc635b635ef623959c8ca545ca6cd03423086dc363cf6ff4012f55`.

Command and result:

```text
/Users/bayou/homebrew/opt/node@24/bin/node ./node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.test.ts --maxWorkers=1
PASS: 1 file, 45 tests
```

## Frozen reattach gate finding

The retained data path in `pty-reattach-output-gate.ts:38-63` uses arbitrary string slicing (`data.slice(-MAX_BUFFERED_REATTACH_OUTPUT_CHARS)` and `first.data.slice(excess)`) and clears sequence metadata when it trims. `release()` flushes those bytes unchanged (`:71-74`). A synthetic Node 24.18.0 run sent `"x\\x1b[31m" + "y".repeat(2 * 1024 * 1024 - 4)` through the actual gate. It overflowed and the retained prefix was `[31m`; writing that prefix into the existing `@xterm/headless` dependency produced the visible row `[31m` (`visibleLiteralSgr: true`). This demonstrates that a mid-CSI cut can account for literal SGR fragments; it does not prove that this was the cause of a particular screenshot.

The cold-restore caller warns and skips historical scrollback on overflow, then applies mode resets and releases the gate (`pty-connection.ts:5518-5550`). The warning does not make the retained tail sequence-safe. A targeted correction should make overflow trimming aware of terminal control-sequence boundaries across chunks: discard any control sequence already open at the trim point through its terminator, then resume from a parser ground state while preserving subsequent ordinary bytes. It should include SGR and cursor CSI cases plus OSC/DCS split-boundary cases and verify the actual xterm buffer. Do not solve this by stripping all ANSI.

Exact reviewed freeze hashes (all unchanged from the earlier reviewed delivery):

| Path | SHA256 |
| --- | --- |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.ts` | `ab533e1c798424fff17a045919c39eecf9bdcce8401fe4d22253b953e8ba073f` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.test.ts` | `1ddcda476a1847679791d383d554b77c19f4f917ee937411f09a814ed72c5f1d` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.ts` | `c2af11374862ffe3cefe4c48e5bffd88f9ea94346a3c1c0acb6666ae68c9bf48` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts` | `3ca529cda6cb867574fb0a7f22daca721b20a150bc59d152ea77b2a4b801c114` |

## Query filtering and replay boundaries

`terminal-startup-color-query-replies.ts:152-185` carries a partial recognized OSC query across chunks and filters only a completed query. In the main PTY listener, `pty.ts:1919-1925` intentionally omits `seq` and `rawLength` whenever filtering changes the data. During hidden-output recovery, `pty-connection.ts:4710-4729` returns an unsequenced queued chunk unchanged, while `:4816-4825` uses a fresh snapshot only when sequence metadata exists but raw and cleaned lengths disagree. This leaves an unverified overlap case: if a filtered chunk also contains visible bytes queued during snapshot recovery and the headless snapshot already covers those bytes, the unsequenced chunk cannot be trimmed and may be appended twice. I did not promote this interaction to a demonstrated screenshot cause or edit the frozen receiver; the next bounded review should add a regression for a filtered OSC query plus visible bytes racing the hidden snapshot, and choose a fail-closed fresh snapshot when the overlap cannot be mapped.

The reattach result path explicitly selects one source in priority order (`pty-connection.ts:5472-5506`): snapshot, then relay replay, then cold restore. The reset bytes affect terminal modes and cursor state; they cannot repair printable suffix bytes left by an arbitrary truncation. This path review did not reproduce duplicated headers, so that screenshot symptom remains unproven.

The main runtime transcript/preview path is separate from xterm delivery. `dobius-runtime.ts:24293-24346` incrementally parses terminal controls with per-PTY pending state, and its 4,096-character pending-control bound applies to transcript normalization. This source path does not establish a cause for renderer corruption; no stateless 4 KB strip path was found in the displayed PTY stream.

## Checks and limits

- Focused scheduler suite: PASS, 45/45, explicit Node 24.18.0, `maxWorkers=1`.
- Synthetic overflow probe: PASS as a defect reproduction; actual gate output `[31m` was rendered by xterm-headless as literal `[31m`.
- No broad tests, app/service probing, PTY input, install/build/restart, or live screenshot validation.
- Previously reviewed chronology sources and tests were read-only and their exact hashes still match the prior receipt.
- Source reproduction is not installed or live acceptance; the two-agent header duplication remains unproven.
- One `worker_done` IPC attempt failed with “Could not connect to the running Dobius app”; I did not restart it and used this report plus the fixer.json receipt as the required file fallback.

Verdict: `SCHEDULER_ASSERTIONS_FIXED; FROZEN_ANSI_OVERFLOW_REPRODUCED; DUPLICATED_HEADERS_UNPROVEN`.
