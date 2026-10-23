# C05 trusted capacity integration contract

Read-only source contract, 2026-10-14. The current tree has a robust capacity *reader/collector* boundary, but no authoritative producer for complete non-C02 commitments. There is therefore no safe adapter from an existing source today; dispatch must remain unavailable until a complete reservation owner is identified and all writers that can promise space participate.

## What owns disk bytes today

The only durable byte reservation writer found is C02's `cloud_capacity_reservations` table in `cloud-jobs/database.ts`. `claimWorkerJob()` computes `max(job.estimatedBytes, assignment.minimumWorkingBytes)` and inserts that amount in the same `BEGIN IMMEDIATE` transaction as the running attempt. `CloudJobStore.persistedQueueReservedBytes()` sums the device rows; `authorizeWorkerStart()` re-reads the current sum and checks the exact reservation under its immediate transaction. C02 lifecycle code retains the row while execution/stop is unproven and removes it only on defined cancellation or settlement paths. This is the queue reservation component and must continue to be counted exactly once by the queue; it is not an external-reservation source.

C04 System Monitor is a sampler/inventory and pure admission calculator, not a reservation allocator. `storage_monitor.py` writes version-1 `status.json` snapshots with volume `freeBytes`, `usedBytes`, and inventory data. `monitor_state.write_json()` publishes that snapshot by temporary-file write, `fsync`, atomic replace and directory `fsync`; the monitor instance lock excludes concurrent monitor/config writers. It does not publish reservation rows, a reservation revision, filesystem-bound capacity commitments, or an execution lease. Its `admit` CLI accepts caller-supplied `--reserved-bytes` (default zero) and only prints a calculation; its README explicitly says admission is not an atomic job reservation. The TypeScript `evaluateSystemMonitorAdmission()` likewise requires caller-supplied `reservedBytes` and performs no persistence or fencing. Neither C04 status nor an `admit` decision can be used as trusted non-C02 capacity evidence.

The broader source search found other reservations, but none account for future disk bytes: workstation worker `execution-reservation.ts` locks profile-home/worktree identities; Voice Conductor `work-registry.ts` limits concurrent work items; automation dispatch tokens reserve a dispatch operation; workspace provenance coordinates worktree creation; Data Catalog lifecycle reservations bound scan sessions. These mechanisms have no byte estimate, filesystem reservation record, or capacity revision. The ordinary agent/automation/build paths can write files but do not expose a common disk-byte reservation API. Thus the codebase has no authoritative source that can truthfully assert complete coverage of non-C02 space promises across a worker filesystem. No remote or private enrollment/config was read to infer otherwise.

## Existing C05 contract and trusted boundary

`cloud-worker-capacity-collector.ts` already accepts the exact reader shape needed for a future authority:

```ts
type ExternalWorkerReservationReader = (input: {
  deviceId: string
  filesystemId: string
}) => unknown
```

The collector rejects unknown fields and requires `deviceId`, decimal `filesystemId`, `coverage: "all_non_c02_reservations"`, `complete: true`, `revision === currentRevision`, safe nonnegative `reservedBytes`, and a sample no more than 5 seconds old. It reads this authority twice and requires the same revision and byte total, while the approved directory identities remain unchanged. Its `freeBytes` is Linux service-available disk (`bavail * block size`), descriptor-bound to a single verified filesystem shared by all approved roots, worktrees, both Hermes homes, state and artifact destinations. It deliberately does not subtract C02 reservations.

This snapshot format is a validation contract, not proof that the callback is trustworthy. A private JSON file with a self-asserted `complete` flag, the current System Monitor `status.json`, a caller-provided zero, or a count inferred from timestamps would not establish completeness. The current `createPrivateCloudWorkerCapacityReader()` reads a private, bounded, device-bound `worker-capacity.json` and checks its 5-second age, but no source writer for this receipt exists. `main/index.ts` currently injects that reader into `createConfiguredCloudWorkerHostFactory`; it does not inject the descriptor-bound collector.

The sample's two identical revision reads protect collection from a changing callback during that sample. They do not serialize an external allocator that reserves bytes after the sample but before C02's `claim()` transaction. If non-C02 writers remain independent of the queue database, a read-only snapshot adapter alone cannot prevent this race. The production contract must therefore make all participating space claims serializable with C02 claim/start admission, or provide an authority-issued compare-and-reserve permit that the queue transaction verifies. A fresh sample is necessary but is not an atomic capacity reservation.

## Smallest safe implementation path

No existing non-C02 writer can be adapted to the current reader contract. The smallest trustworthy future design is one shared reservation authority, not another job queue:

1. Extend the existing `CloudJobStore` SQLite transaction domain with a separately typed non-C02 capacity-reservation ledger and monotonically changing reservation revision. Give it explicit `reserveExternalCapacity()` / `releaseExternalCapacity()` operations bound to producer ID, reservation ID, device, filesystem identity and bytes. Keep job claims, external reservations and the aggregate revision in the same database and serialize changes with `BEGIN IMMEDIATE`; do not give an external producer direct SQL or caller-controlled byte totals.
2. Require each Dobius-managed non-C02 launcher that can promise future disk use to acquire a reservation before its first filesystem side effect and retain it through failure/cancellation until its own process/output cleanup is proven. Release by exact reservation and terminal evidence only. A reservation cannot expire solely because its wall-clock TTL elapsed while work may still be active. Any producer that cannot join this authority must either be excluded from the worker filesystem while dispatch is enabled or keep C05 unready; it cannot be silently treated as zero.
3. Make C02 `claim()` and start-permit admission read and account for the same current external ledger revision and current C02 queue total inside their existing immediate transactions. If a sample's revision is stale, refuse/re-sample before claim/permit. The capacity telemetry must also remain bound to the collector's verified filesystem ID. This closes the gap between a double-read snapshot and a later queue transaction.
4. Expose a trusted synchronous `readExternalReservations({ deviceId, filesystemId })` adapter over that ledger, returning only the aggregate of outstanding non-C02 rows and its current revision/sample time. The collector can then produce the existing `CloudWorkerCapacitySample`; the total must exclude C02 queue rows and filesystem allocations already reflected by statfs. When producer coverage cannot be enumerated, the adapter throws/unavailable rather than returning `complete:true`.

Candidate file scope for ROOT to allocate after all producer owners are identified:

- Existing authority/transaction files: `dobius/src/main/automations/cloud-jobs/database.ts`, `store.ts`, `cloud-worker-claim.ts`, `cloud-worker-start-ledger.ts` and their focused store/QueuePort tests. They must preserve the one SQLite store and include the non-C02 ledger in the same serialized capacity decision.
- New focused adapter: `dobius/src/main/automations/cloud-jobs/cloud-worker-external-reservations.ts` and `.test.ts`, only if the store reader cannot remain a small typed method. It would implement the existing collector callback above; it is not a second database or queue.
- Existing physical sampler: `cloud-worker-capacity-collector.ts` and `.test.ts` need changes only if the transaction revision or capacity identity must be propagated through its output. Existing collector code already handles Linux descriptor-bound measurement and external snapshot validation.
- Existing host wiring: `cloud-worker-bootstrap.ts` and the constructor-owned `workerHostFactory` composition in `cloud-job-authority.ts` / `main/index.ts` must construct the collector only after the private worker configuration and actual approved paths are known. The current `worker-capacity.json` reader must not remain the active source unless a reviewed trusted producer actually writes it.
- Every newly identified external disk allocator needs a focused participant adapter/test in its own owner scope. The source search did not identify a current disk-byte allocator to enroll; ROOT must decide whether those generic agent/build paths are out of scope for the dedicated worker filesystem or must be brought under this reservation owner.

No non-C02 reservation authority can be implemented now from the available source. The existing C02 reservation owner and Linux collector are usable after the missing shared participation/atomicity contract is assigned; C04 monitoring remains useful for current free-space/status views but cannot supply future commitments. Source-only mock completion flags and zero-byte snapshots would falsely certify the missing producer and are not acceptable.

## Acceptance fixtures for the eventual authority

- Snapshot must be sourced only through constructor-owned trusted code; caller input may select the validated device/filesystem but cannot assert coverage, completion, revision, reserved bytes, or freshness.
- An unknown producer, incomplete producer registry, missing filesystem mapping, stale/future timestamp, wrong device/filesystem, invalid amount, changed revision, duplicate reservation ID, or storage read error refuses both readiness and claims. No fixture may convert missing state into zero.
- Two non-C02 reservations racing each other or C02 claims serialize in one database authority; the second admission observes the first reservation and cannot overbook. Start permit rechecks the exact current total/revision after claim.
- Reopen preserves active reservations and monotonically changing revision. Cancellation, interrupted cleanup, or lost process proof retains bytes; exact verified terminal cleanup releases once. Duplicate release is idempotent and cannot release another producer's row.
- C02 reservations are counted once through `cloud_capacity_reservations`; external totals exclude those rows. Already allocated bytes remain reflected in filesystem free space and are not subtracted again.
- A reservation inserted or removed between telemetry sample and claim/permit forces refusal or a fresh sample inside the serializable admission boundary; matching timestamps alone do not imply overlap.
- C04 `status.json` and the `admit --reserved-bytes` CLI cannot pass as a reservation authority. `admit`'s default zero remains a local what-if default only, never C05 evidence.
- Adam and Friday remain the exactly two requested Hermes heads mapped to `hermes-1` / `hermes-2`, with exclusive profile ownership; do not add agents or modify their tabs/config/accounts. Runtime enrollment and provider/auth proof remain separate prerequisites.

## Scope and current result

This task made no source/config changes and ran no tests. It read schemas and implementation only; no private enrollment/auth files, live database, personal originals, service, SSH, provider, build, install, deployment, AWS, or historical Storage state was accessed. The only deliverables are this contract and `capacity-integration-contract-20261014` in `plans/cloud-workstation-reports-20261012/build2.json`. Local build 20 is recorded with live dispatch unavailable; VPS cohort 19 predates the current C05 composition; the report records `workerConfigured: false` and `externalReservationsAuthorityExists: false`. Adam and Friday were not touched.
