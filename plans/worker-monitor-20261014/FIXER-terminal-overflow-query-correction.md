# Terminal overflow query correction

Task `task_dcaa4f8dcdfd`, dispatch `ctx_55885b9289d1`; repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`.

## Review findings and corrections

The independent review in `BUILD1-terminal-overflow-correction-review.md` (SHA256 `132dc640cfa65be54cb990517a4e0b8a3b45655fab37ddeef6bbc82d09ff14b7`) returned `CHANGES_REQUIRED`. The prior five-file source freeze was released for this correction.

1. **Live query replies through overflow:** the gate now scans buffered chunks only when it crosses the existing 2 MiB / 4,096-chunk bound, then scans later gated chunks while the visual stream remains suppressed. The new bounded recognizer handles only stateless DA1 (`CSI c` / `CSI 0c`), pixel-size (`CSI 14t` / `CSI 16t`), and OSC 10/11 color queries, including split frames; cursor/state queries are not synthesized. Replies use the existing DA1 variants, pixel-size responder, and OSC color reply function. If a supported frame began before release and finishes after release, the scanner answers once and removes only the orphaned continuation bytes from renderer output while reducing `rawLength`; ordinary subsequent bytes keep their original sequence metadata. Discarding a failed reattach resets its partial scanner state.

   The connection regression places DA1 and OSC 11 in held data that is later discarded, overflows the cap, starts a pixel-size query while overflow suppression is active, then completes it after release. It asserts one `transport.sendInput` reply for each query, no clipped filler or orphaned query suffix in terminal writes, and no duplicate reply when the authoritative snapshot contains DA1/OSC queries. Its simulated parser invokes the installed reply handlers during snapshot replay, exercising the existing replay guard.

2. **Split surrogate accounting:** the existing cap remains 2 MiB and 4,096 chunks. Byte accounting intentionally treats callbacks independently, charging a high or low surrogate split across callbacks as a replacement character on each side. This is a conservative upper bound (at most two extra bytes for a split pair), so the encoded buffer cannot exceed the byte cap; it may request snapshot recovery slightly early. The gate regression fixes ASCII data at `limit - 4`, splits one valid pair across callbacks, and verifies that conservative early overflow clears the whole stream without clipping.

3. **Void callback return:** `runDeferredConnect(): void` now uses a bare `return` at its early-exit tail. The boolean return in `handleReattachResult(): boolean` remains intact.

## Failure-before and final validation

Failure-before was reproduced by temporarily disabling the new gate query callbacks and running the new focused connection regression. It failed at the DA1 assertion with `transport.sendInput` called zero times, matching the review finding; the callbacks were restored before final checks. A first typecheck of the new test also exposed closure-assignment narrowing errors (`TS2339`/`TS2349`); mutable refs fixed the test fixture. These checks were rerun on the final formatted freeze.

Runtime: Node `v24.18.0`; Vitest uses `--maxWorkers=1`.

- `/Users/bayou/homebrew/opt/node@24/bin/node ./node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/renderer/src/components/terminal-pane/pty-connection.test.ts src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts src/renderer/src/components/terminal-pane/pty-reattach-query-preserver.test.ts src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.test.ts --maxWorkers=1` — PASS, 4 files / 381 tests.
- `PATH=/Users/bayou/homebrew/opt/node@24/bin:$PATH ./node_modules/.bin/oxfmt --write <seven frozen source/test paths>` — PASS.
- `PATH=/Users/bayou/homebrew/opt/node@24/bin:$PATH ./node_modules/.bin/oxlint <same seven paths>` — PASS.
- `/Users/bayou/homebrew/opt/node@24/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit --composite false --incremental false -p config/tsconfig.tc.web.json` (cwd `dobius`) — PASS, exit 0.
- `git diff --check -- <seven frozen source/test paths>` — PASS.

## Exact final source freeze

| Path | SHA256 |
| --- | --- |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.ts` | `eb06ebfdb359b674296630ef6315f307a16a73f6d7410f6e852f281c6009e5c6` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.test.ts` | `760eea9fddc496141e652c5742ffdd8bc1cb694e9613b2cb2000d497e1c11d44` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.ts` | `9d22b03b05bfbb4c17a680478a8fd674963d533245a7ebf4fb9bc68c0df38587` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts` | `61c006b6581270e5119a0fd1fdfaffd928aa49f1c387609a631ee85f6a12e16d` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-query-preserver.ts` | `1b089ba33ea734529fa6548e566a1561b8045873060aeb6efdd48c39aae1eaab` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-query-preserver.test.ts` | `2684b8ee0e939d9d9fa0924acc98513355a62f8e670c8487162f30850e7ff994` |
| `dobius/src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.test.ts` | `748447eb75bc635b635ef623959c8ca545ca6cd03423086dc363cf6ff4012f55` |

## Limits

This is focused synthetic source/test evidence. No install, app restart, live terminal input, screenshot, SSH/mobile runtime, provider/service/device operation, or head-agent action was performed. Snapshot recovery remains dependent on the existing main-process snapshot API; if unavailable, existing code warns the screen may be incomplete. Stateful cursor queries are deliberately not answered by this overflow scanner, and this is not live acceptance. Independent review should repeat against the exact hashes above.
