# Cloud job catalog and queue store

This module is the persistence boundary for the C02 queue prototype. It stores
validated projects, idempotently submitted jobs, worker attempts, lease state,
transition events, and the persistent dispatch pause in one SQLite database.

Every claim and job transition uses an immediate SQLite transaction. Claims are
fenced by an expiring random lease token whose hash is persisted, and lease loss
marks work interrupted until the owning worker confirms process cleanup. A
successful worker result moves to `needs_review`; only a separate evidence-bearing
acceptance can mark the job completed. Dispatch starts paused and remains paused
across database reopen until explicitly enabled.

Claims reserve `max(job.estimatedBytes, assignment.minimumWorkingBytes)`
transactionally by target device, retaining the original estimate and request
fingerprint unchanged. Each trusted recipe assignment owns its working-space
floor; an omitted floor defaults conservatively to 20 GiB, while a proven no-op
recipe may explicitly set zero.
Reservations survive lease expiry, cancellation and process-stop reconciliation,
and are released only when execution settles or the owning worker confirms that
its process tree stopped. Capacity samples carry `externalReservedBytes`, which
must exclude queue-owned bytes. Claim and start-permit checks use the same formula:
free bytes minus authenticated external reservations, current persisted queue
reservations, and safety bytes. The former ambiguous total-reservations DTO is
rejected by strict schema validation; the store never guesses overlap from
timestamps or subtracts a sampled queue value.

Local project roots are revalidated with `realpath` and directory checks. A root
on another device is accepted only through the server-owned `CloudRootAuthority`
adapter, which must return a fresh identity for the exact project and device from
authenticated enrollment. The RPC caller's root string is ignored for remote
projects, and the store rechecks the same enrolled root before each claim; absent,
expired or mismatched authority denies dispatch. The adapter is an integration
seam, not an enrollment protocol implementation.

`CloudWorkerQueuePort` is a trusted in-process adapter from C05's `QueuePort` to
this store. Its strict `CloudWorkerEnrollment` and telemetry/root/time callbacks
are constructor-owned; it exposes no RPC and accepts no mobile or client
self-enrollment. The enrollment maps each project/recipe pair to a server-approved
root, worktree, profile, working-space floor, and exact resource caps. The adapter
refuses ambiguous mappings and derives every `WorkerClaim` identity field from
that policy and the durable job.
Settlement requires the owning started lease; success requires exit code zero,
while a trusted failed receipt may report zero when artifact or verification
checks fail after process exit.

The v3 schema adds a per-attempt start permit and immutable started process
identity (PID, process start, process group, boot ID, and worker incarnation).
Permit issue rechecks the active lease, fresh root authority, capacity sample,
and persisted device reservation in one immediate transaction; the permit is
exact-binding, expires no later than its lease, and identical unconsumed retries
return the persisted permit. Started identity cannot be changed. Heartbeats and
settlement require that durable start record. Stop cleanup requires a typed C05
process-group receipt bound to that record and the permit's source binding;
free-form cleanup strings cannot release a reservation. Legacy active v2
attempts migrate without fabricated process identities and remain fail-closed
for stop acknowledgment until independently reconciled.

`exportBackup(destination)` uses Node SQLite's online backup API, validates the
result with `quick_check`, and publishes a private mode-0600 file atomically only
when the destination does not already exist. A restored store can be reopened
from that file, including active jobs and their capacity reservations.

The adapter does not start workers or execute shell commands, and is not a live
worker transport. No RPC method authenticates worker enrollment yet; an in-process
trusted caller remains a required boundary. The device's C05 registry still
performs exact worktree, revision, executable, private-profile, and inode checks
immediately before spawn; the server never resolves remote laptop paths itself.
Kanban/board projection and operational backup scheduling remain outside this
module.
