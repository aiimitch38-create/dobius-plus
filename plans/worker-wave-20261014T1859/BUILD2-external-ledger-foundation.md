# BUILD2 external reservation ledger foundation

Recorded 2026-10-14 in the canonical `fix/channel-cost` worktree. This is a
source-only persistence foundation; it is not wired into production capacity
collection, claim admission, worker dispatch, or enrollment.

## Implementation

`database.ts` advances the shared cloud-jobs SQLite schema from version 4 to
5. It adds a per-device/filesystem monotonic revision table and a separate
non-C02 reservation table. The existing C02 queue reservation table and its
rows remain unchanged. New and old database files take the same migration
path, and reservations remain in the same SQLite file and transaction domain.

`cloud-worker-external-reservations.ts` provides a producer-scoped handle bound
at trusted construction to one producer identity, device, and decimal
filesystem identity. Reserve and release operations validate safe integers
and compare-and-swap revisions inside `cloudTransaction` (`BEGIN IMMEDIATE`).
Reservation identity, owner, filesystem, byte amount, and initial revision are
immutable. A release requires the same producer handle; duplicate release is
idempotent only for that exact owner and identity. Rows remain as tombstones,
so identities cannot be reused and uncertain cleanup does not erase bytes.

`readSnapshot()` sums only active rows from the non-C02 table, leaving C02
queue bytes in their existing owner. It always returns
`availability: "unavailable"` with `participant-coverage-unverified`; it does
not emit `complete: true` or a collector-compatible capacity sample. Allocated
bytes are outside this ledger and remain reflected by filesystem `statfs`.
Unknown participants therefore cannot be mistaken for zero outstanding
capacity.

## Verification

Node 24.18.0, pnpm 10.24.0; `UV_THREADPOOL_SIZE=32`, one Vitest worker.

```sh
PATH=/Users/bayou/homebrew/opt/node@24/bin:$PATH UV_THREADPOOL_SIZE=32 pnpm exec vitest run src/main/automations/cloud-jobs/cloud-worker-external-reservations.test.ts --config config/vitest.config.ts --maxWorkers=1
PATH=/Users/bayou/homebrew/opt/node@24/bin:$PATH UV_THREADPOOL_SIZE=32 pnpm exec oxlint src/main/automations/cloud-jobs/database.ts src/main/automations/cloud-jobs/cloud-worker-external-reservations.ts src/main/automations/cloud-jobs/cloud-worker-external-reservations.test.ts
PATH=/Users/bayou/homebrew/opt/node@24/bin:$PATH UV_THREADPOOL_SIZE=32 pnpm exec oxfmt --check src/main/automations/cloud-jobs/database.ts src/main/automations/cloud-jobs/cloud-worker-external-reservations.ts src/main/automations/cloud-jobs/cloud-worker-external-reservations.test.ts
```

Result: focused Vitest **7/7 passed**, scoped Oxlint passed, and scoped Oxfmt
passed. Fixtures use temporary SQLite databases and cover schema-v4 migration
with preserved C02 rows, reopen persistence, two-connection stale-CAS refusal,
duplicate identity conflict, wrong producer/device/filesystem, exact-owner
release and replay, transaction rollback with unchanged queue rows, safe-byte
validation, and revision exhaustion.

## Frozen paths and limits

The exact implementation paths and per-file SHA-256/byte counts, plus the
aggregate recipe, are recorded in `build2.json` under
`external-ledger-foundation-20261014`.

This ledger does not enroll any real producer, establish that all filesystem
writers participate, or close the sample-to-claim race. The existing collector
and C02 claim/start transactions are not integrated with this revision. No
complete snapshot, production readiness, or live dispatch claim is made. No
build, install, deployment, service action, provider call, credential read, or
live worker operation was performed.
