# BUILD1 terminal framing and reattach lifetime independent review

Task `task_a4be87144be5`; dispatch `ctx_c1edc08f2ea2`. Repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`.

**Verdict: PASS_BOUNDED_SOURCE.** I independently recomputed the author report and all seven frozen source/test hashes; every value matches `fixer.json#terminal-framing-lifecycle-correction-resume-20261014`. The two prior findings are closed in the current implementation and have focused scanner and production-composition regressions.

## Exact reviewed freeze

| Path | SHA-256 |
|---|---|
| `plans/worker-monitor-20261014/FIXER-terminal-framing-lifecycle-correction.md` | `c13924fb13c15f96ddad6988db89a0fe8699b1f7924796e9ab279483daa2e555` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.ts` | `50aa7de3e923d90871803dee5d1b6efc498c0ebcc8b9d92680afc958ac34ad73` |
| `dobius/src/renderer/src/components/terminal-pane/pty-connection.test.ts` | `3b8a77eeed5546814992fe5d642f3b78c89474ee3c9d6e42697954aa8b6aeae1` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.ts` | `bf314208111a9d77fb80d5869610a367d2b39a6859a42a1770f9d88b578556d4` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-output-gate.test.ts` | `7af55f7d15d775f9f24ed03029bcb09b02796c53c806289e1b04f537acef93de` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-query-preserver.ts` | `f5fcdaefe0889cf37fc0e5cbac7ca0cd329b61e21647a77f0e1b138bb64615e9` |
| `dobius/src/renderer/src/components/terminal-pane/pty-reattach-query-preserver.test.ts` | `67ab872804e920e3a3675cba4bfc444ac074d4e9bb17c5d55b48cc03ca0bfd22` |
| `dobius/src/renderer/src/lib/pane-manager/pane-terminal-output-scheduler.test.ts` | `748447eb75bc635b635ef623959c8ca545ca6cd03423086dc363cf6ff4012f55` |

Author report SHA-256: `c13924fb13c15f96ddad6988db89a0fe8699b1f7924796e9ab279483daa2e555`.

## Review evidence

- The bounded preserver frames unsupported/incomplete CSI and escape sequences through their completion, OSC through BEL/ST, and DCS/SOS/PM/APC strings through ST or CAN/SUB. Query-like content inside string payloads is not interpreted. Candidate storage is capped; only exact supported DA1, pixel-size, and OSC 10/11 stateless requests produce replies. The tests cover split chunks/release, malformed OSC with visible text afterward, unsupported `CSI 6 n` continuation, nested strings, C1 framing, cancellation, and candidate reset.
- The gate stays permanently discarded after `discard()`, clears buffered data, and ignores later data/release. The connection owns a single active gate and monotonically changes its generation when replacing/discarding it. Query, data, overflow, and replay callbacks check that gate against the live binding; snapshot recovery checks liveness before scheduling, around the awaited snapshot, and before applying it. Async replay writes recheck liveness between writes.
- Connection tests exercise the composed callbacks: an unsupported CSI suffix is suppressed while subsequent visible text survives; malformed OSC behaves similarly; supported replies remain once-only across snapshot replay; deferred callbacks after disposal cause no input, terminal writes, or snapshot request; and callbacks from an old disposed binding do not affect the replacement while the current binding still answers its query.
- Inspected source retains conservative split-surrogate byte accounting, bounded buffering, snapshot > replay > cold-restore precedence, sequence-reconciled hidden-output recovery, mobile-fit resize ownership, SSH/no-snapshot warning paths, and replay reply guards. No new blocker was found in those paths.

## Validation and limits

I did not rerun tests, consistent with the review dispatch. Since all hashes match, I relied on the exact author-recorded Node 24 focused run: 6 files / 415 tests PASS with `--maxWorkers=1`; canonical renderer typecheck PASS (exit 0); scoped lint, format, and diff checks PASS. The source freeze is not installed/live acceptance: no actual PTY, SSH/mobile runtime, screenshot-wide rendering, terminal input, or snapshot-service availability was exercised. Vendor-specific control protocols outside the documented ESC/C1 framing remain unparsed; an unterminated dropped frame intentionally stays suppressed until a recognized terminator or cancellation.
