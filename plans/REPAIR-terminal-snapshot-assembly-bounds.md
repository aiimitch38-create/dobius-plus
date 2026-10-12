# Repair: bound incomplete mobile terminal snapshots

Workflow: applying `/Users/bayou/.claude/skills/crack_repair/SKILL.md` through diagnose -> plan -> fix -> verify -> review -> commit -> log. Diagnosis and implementation are complete; commit is held for final independent review.

## Diagnosis

Iris's final report (SHA `4ac8eaaf71cc923c96d7f0965fc1c9c4ca14f1006e1a51b9d119606715c9d7a4`, qualified native addendum) found that `rpc-client-terminal-binary-frame.ts` retains decoded snapshot chunks without byte/count/age limits until `SnapshotEnd`. A missing end frame leaves the chunks retained; successful completion joins a second full string. This is a defensive guard gap for malformed, incompatible, or interrupted streams, not demonstrated normal-path exhaustion.

The 512 KiB mobile and 2 MiB requested-snapshot byte values are soft row-reduction targets, not hard producer limits. Both serializers return the zero-scrollback fallback even when it exceeds the target, and the server currently sends every resulting chunk. A 512 KiB client rejection can therefore reject a valid oversized fallback; raising the client limit to 2 MiB would still be an unsupported guess. The mobile viewport accepts up to 1000 columns by 500 rows, so zero-scrollback snapshots can legitimately exceed the soft target. Obsidian note relied on: `Dobius Repair Peer Review Queue 2026-10-08.md`, Iris section; independent source qualification: RESEARCH message `msg_dbca4f6444ce` and manager review `msg_535b58eded1c`.

## Plan

- Preserve 512 KiB mobile and 2 MiB requested values as soft row-reduction targets. Use a separate shared 8 MiB binary admission ceiling as a resource policy, not a claim that every legal snapshot fits. Keep complete snapshots up to the ceiling; beyond it send the existing Error opcode with a plain message and no SnapshotStart/Chunk/End sequence. Follow it with geometry-only Resized so an initial refusal can initialize an empty live terminal and render subsequent output.
- Keep a bounded client chunk-count ceiling of 256 and fixed 30-second assembly deadline. The server's 48 KiB chunking produces at most 171 chunks at the admission ceiling.
- Clear timers/buffers on SnapshotEnd, replacement SnapshotStart, stream removal, reconnect, malformed/over-budget data, and expiry.
- On malformed/incomplete transport, discard partial text and emit a typed `snapshot-error`; allow one bounded recovery attempt. For the producer's existing Error opcode with the oversized message, clear any partial assembly, emit a typed non-retryable event, continue live output, and show a terminal-scoped warning that clears after a later valid snapshot.
- For an over-ceiling resize reflow, send the Error opcode followed by the existing geometry-only Resized frame so phone dimensions stay coherent. For an oversized initial snapshot, the mobile session initializes xterm from that geometry-only frame after recording the warning; later live output then writes into a ready terminal, while no empty SnapshotStart/End is emitted. Apply the admission check centrally in `sendSnapshotFrames` so initial, resize, requested, desktop, and mobile binary producers use the same policy; legacy clients see the existing Error opcode and never receive an empty successful snapshot.
- Preserve viewport/ownership behavior, normal snapshots, sequence metadata, and output routing.

Implementation files: `src/shared/terminal-scrollback-limits.ts`, `src/shared/terminal-stream-protocol.ts`, `src/main/runtime/scrollback-limits.ts`, `src/main/runtime/rpc/methods/terminal.ts`, `src/main/runtime/rpc/terminal-subscribe-buffer.test.ts`, `mobile/src/transport/terminal-stream-protocol.ts`, `mobile/src/transport/rpc-client-terminal-binary-frame.ts`, `mobile/src/transport/rpc-client-terminal-binary-frame.test.ts`, `mobile/src/transport/rpc-client.ts`, `mobile/src/transport/terminal-snapshot-recovery.ts`, `mobile/src/transport/terminal-snapshot-recovery.test.ts`, `mobile/app/h/[hostId]/session/[worktreeId].tsx`.

## Regression coverage

Regression coverage covers a complete zero-row fallback above 512 KiB, exact and overflowing UTF-8 wire-byte boundaries, maximum normal chunk count, producer over-ceiling Error plus geometry-only Resized behavior, client Error mapping and retry termination, actual binary Error -> geometry -> Output routing with initialization before the first write, preserving an existing terminal during oversized reflow, chunk-count overflow, missing-end expiry, replacement-start cleanup, end-frame assembly, and lifecycle cleanup. Crack_repair skill use: diagnosis was updated after RESEARCH established the soft-budget fallback exception; no ANSI slicing, dependency/config changes, install, or live update was performed.

## Rollback

Revert only the focused snapshot-assembly commit. No native changes, ANSI slicing, dependency/config changes, or implicit viewport changes are planned.

## Verification status

Verification evidence:

- `PATH=/Users/bayou/homebrew/opt/node@24/bin:$PATH pnpm exec tsc --noEmit -p tsconfig.json` from `dobius/mobile`: exit 0.
- Scoped mobile `pnpm exec oxlint ...`: exit 0. Root server `oxlint` via the existing mobile binary: exit 0.
- Mobile and root `oxfmt --check` plus `git diff --check`: exit 0.
- Node 24 `tsx` direct execution of the actual `terminal.subscribe` handler: passed complete 524,289-byte snapshot, exact 8 MiB UTF-8 snapshot in 171 chunks, and 8 MiB + 1 byte refusal followed by geometry-only Resized. A second direct execution passed oversized reflow Error followed by geometry Resized.
- Node 24 `tsx` direct execution of the actual mobile frame handler/recovery helper: passed >512 KiB acceptance, exact UTF-8 ceiling acceptance, oversized Error mapping/partial-state cleanup, one retry for incomplete streams, and zero retries for producer-declared oversized snapshots.
- The package-local mobile Vitest 4.1.9 attempt exits 1 before collection with Vite/OXC `TSCONFIG_ERROR: Tsconfig not found` (0 tests). With the manager-authorized dependency symlink to the hash-matched candidate dependencies, candidate Vitest 4.1.5 passed the focused mobile files: 2 files, 16 tests. The focused server suite on repair source with the same matched dependency set passed: 1 file, 11 tests. Mobile `PATH=/Users/bayou/homebrew/opt/node@24/bin:$PATH /Volumes/Storage/dev/dobius/dobius/mobile/node_modules/.bin/tsc --noEmit -p tsconfig.json` and desktop `pnpm run typecheck:node` both exited 0.
- Formatting checks for all changed mobile and server source/test files plus `git diff --check` exit 0. No physical-device test, install, push, or live update. The temporary dependency symlink is only for validation; the pre-existing `.vite` cache is preserved at `/tmp/dobius-phone-orchestrator-flicker-vitest-cache-20261008`. RESEARCH found the cold-attach gap after the first frozen review; the added error-to-geometry initialization is tested, and a fresh exact-scope review and commit remain pending.
