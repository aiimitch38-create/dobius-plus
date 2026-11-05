# Terminal reattach overflow correction

Task `task_25f1dc2c0ca3`, dispatch `ctx_312f7964a3fa`.

## Review and correction

The independent review in `BUILD1-terminal-reattach-order-review.md` (SHA256 `731b3533ff41a479443a151d63cac38c3ccf3f9d8095faa02c48975497698e45`) returned `CHANGES_REQUIRED`. The prior four-file freeze was released for this correction.

The reattach output gate now measures the buffered cap as UTF-8 bytes (2 MiB) and enforces a 4,096-chunk cap. Its byte counter handles valid surrogate pairs as four UTF-8 bytes and unpaired surrogates as the three-byte U+FFFD encoding. When either cap would be exceeded, it clears the entire partial VT stream and suppresses further gated output until release; it never slices through CSI/OSC or a Unicode character. This avoids replaying a corrupted suffix.

After the gate releases, the connection requests the existing authoritative main-process terminal snapshot when available. It uses the existing hidden-output restore and sequence reconciliation path so output arriving during the recovery is reconciled with the snapshot. If that snapshot cannot be obtained, it displays an explicit incomplete-terminal warning; this is not represented as successful restoration. Normal under-cap history-before-live ordering and the existing replay/snapshot precedence remain in place.

Regression coverage includes split CSI, split OSC, and a split surrogate pair at overflow, with actual `@xterm/headless` assertions that the recovered screen contains no literal CSI parameter fragment and no U+FFFD replacement character. A connection-level regression verifies that a large early reattach stream is replaced by the authoritative current snapshot and that no clipped content is rendered. The prior two stale scheduler warning-string assertions were retained and are green.

## Validation

Runtime: explicit Node `v24.18.0`; Vitest configured with `--maxWorkers=1`.

- `.../node@24/bin/node ./node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/renderer/src/components/terminal-pane/pty-connection.test.ts src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.test.ts --maxWorkers=1` — PASS, 3 files / 377 tests.
- `PATH=/Users/bayou/homebrew/opt/node@24/bin:$PATH ./node_modules/.bin/oxfmt --write` scoped to the five frozen source/test files — PASS, 5 files formatted.
- `PATH=/Users/bayou/homebrew/opt/node@24/bin:$PATH ./node_modules/.bin/oxlint` scoped to the same five files — PASS.
- `git diff --check` scoped to the five source/test files — PASS.

The first focused gate run during implementation caught a stale counter variable in the flush path; it was corrected before the final formatted/linted run. Before this correction, the prior synthetic reproduction showed the 2 MiB code-unit tail clip retained `[31m` from a split CSI and `@xterm/headless` rendered the literal fragment. That fail-before evidence is recorded in `FIXER-terminal-ansi-followup.md` (SHA256 `930bf7fdc3a7838809d12a4cb9675f4860cc6b87001b07dbde323394010cfc3f`).

## Exact final freeze

| Path | SHA256 |
| --- | --- |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.ts` | `db6a4e6739412a0ae9052c5ff1533b3b981b19ffb1600592b4549bbcabe9926b` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.ts` | `8c2b198f24ab51a8673ba8352da4776e01bec5a1b14848b48710931304caef72` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts` | `67311fa130226286406929edc48ee3e0a5ebda30b6da8868937e093068ff6021` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.test.ts` | `fdabb6682a774113cab3b524c7f29c83a54266f627a0e8e496a446e1f20749c6` |
| `dobius/src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.test.ts` | `748447eb75bc635b635ef623959c8ca545ca6cd03423086dc363cf6ff4012f55` |

## Limits

This is focused source/test evidence only. No app install, restart, live terminal input, screenshot, SSH/mobile session, or runtime lifecycle validation was performed. Recovery depends on the existing authoritative main-process snapshot API being available; when unavailable the code warns that the screen may be incomplete. Duplicate Codex/Claude headers remain unreproduced, and this correction does not establish their cause or claim live acceptance. Independent source review should repeat against the exact freeze above.
