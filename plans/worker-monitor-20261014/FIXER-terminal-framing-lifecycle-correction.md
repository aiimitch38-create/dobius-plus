# Terminal framing and reattach lifecycle correction

Task `task_e1707fc26dcf`, dispatch `ctx_a9ac1eb203d0`; repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`.

## Review and corrections

The independent review `BUILD1-terminal-overflow-query-review.md` (SHA256 `96d7125771797ea13a1747cdbe76d33f7f1b252cb967864e13ee9a4da0826380`) found two defects in the prior bounded overflow-query correction. The review reproduced a leaked `n` from a dropped `CSI 6 n`, leaked tails from malformed OSC, and stale query replies/data after binding disposal.

1. **Frame unsupported and malformed controls through a real boundary.** The query preserver now maintains explicit bounded ground, escape, escape-intermediate, CSI, OSC, and string-control states. It suppresses a dropped frame through CSI/escape completion, OSC BEL/ST, string ST, or CAN/SUB cancellation, then returns only following ordinary text to xterm. It tracks DCS, SOS, PM, and APC payloads without recognizing nested query-like bytes; candidate query storage is capped at 32 UTF-16 code units and an overlong OSC remains framed without retaining its body. It also recognizes C1 CSI/OSC/string introducers and C1 ST for framing. Query responses remain limited to exact supported 7-bit DA1, pixel-size, and OSC 10/11 color requests; cursor/state replies are not synthesized. The gate converts consumed UTF-16 prefix length back to UTF-8 byte length when adjusting `rawLength`, preserving sequence offsets after an orphaned frame is removed.

   New scanner regressions cover unsupported CSI across release, malformed extended OSC terminated by both BEL and ST, ordinary text after the terminator, each ESC string introducer with embedded query-looking data, ESC-intermediate/CSI chunks split across release, CAN/SUB cancellation, and C1 string framing. A connection fixture verifies the unsupported CSI continuation is suppressed without a cursor response and the following visible text remains; another connection fixture now checks malformed OSC continuation and visible text while retaining exactly-once supported query replies and snapshot replay suppression.

2. **Fence the gate and callbacks to their reattach lifetime.** Each connection retains the current gate with a generation. Creating a replacement discards the prior gate, binding disposal permanently discards and clears the active gate, and failed connect paths discard their own gate without invalidating a newer one. Gate discard now remains closed forever: it drops later callbacks and cannot be reopened by `release()`. Gate data, overflow query callbacks, and replay callbacks check that their gate remains current before changing the terminal, sending input, or starting hidden snapshot recovery. The asynchronous snapshot path checks the supplied gate predicate before scheduling, while reading, and after its await; replay queue writes also recheck the binding predicate between asynchronous terminal writes. No bound PTY ID is required for early data, preserving valid pre-result callback ordering.

   Connection regressions dispose a deferred reattach and then invoke late overflow, data, replay, and connect-result callbacks; they assert zero stale input, terminal output, or snapshot requests. A second fixture disposes an old binding after a new binding is active, verifies old callbacks have no effect, and verifies the current binding can still answer its own DA1 query.

## Failure-before and validation

The new scanner regressions were first run against the prefix-only recognizer. The focused Node 24 command failed 6 of 9 tests: unsupported CSI, malformed OSC BEL/ST, nested string controls, split escape framing, and CAN/SUB termination.

Final focused command (Node `v24.18.0`, one worker):

```text
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/renderer/src/components/terminal-pane/pty-connection.test.ts src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts src/renderer/src/components/terminal-pane/pty-reattach-query-preserver.test.ts src/renderer/src/components/terminal-pane/terminal-capability-replies.test.ts src/renderer/src/components/terminal-pane/hidden-output-restore-scheduler.test.ts src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.test.ts --maxWorkers=1
```

PASS: 6 files, 415 tests. The run includes the full connection fixture suite and all framing, gate, capability, and scheduler regressions.

```text
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit --composite false --incremental false -p config/tsconfig.tc.web.json
```

PASS, exit 0. Scoped `oxfmt --check` and `oxlint` on the six edited terminal source/test files passed. `git diff --check` passed.

## Final source freeze

| Path | SHA256 |
| --- | --- |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.ts` | `50aa7de3e923d90871803dee5d1b6efc498c0ebcc8b9d92680afc958ac34ad73` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.test.ts` | `3b8a77eeed5546814992fe5d642f3b78c89474ee3c9d6e42697954aa8b6aeae1` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.ts` | `bf314208111a9d77fb80d5869610a367d2b39a6859a42a1770f9d88b578556d4` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts` | `7af55f7d15d775f9f24ed03029bcb09b02796c53c806289e1b04f537acef93de` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-query-preserver.ts` | `f5fcdaefe0889cf37fc0e5cbac7ca0cd329b61e21647a77f0e1b138bb64615e9` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-query-preserver.test.ts` | `67ab872804e920e3a3675cba4bfc444ac074d4e9bb17c5d55b48cc03ca0bfd22` |
| `dobius/src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.test.ts` | `748447eb75bc635b635ef623959c8ca545ca6cd03423086dc363cf6ff4012f55` |

## Limits

This is focused source and synthetic test evidence. It does not prove installed or live terminal behavior, SSH/mobile behavior, screenshot-wide rendering, or actual snapshot-service availability. Only the listed VT framing forms are tracked; vendor-specific control protocols outside these ESC/C1 sequences are not parsed. An unterminated dropped frame remains suppressed until a recognized terminator or cancellation, intentionally preferring lost display bytes over exposing an orphaned control suffix. No app restart, install, build, live PTY input, service/provider/device access, private account/config/profile access, or head interaction was performed. Independent review should recompute the hashes above.
