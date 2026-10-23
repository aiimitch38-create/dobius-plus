# Laya and C05 capacity integration contract review

**Review date:** 2026-10-14  
**Verdict:** `CHANGES_REQUIRED_BEFORE_COMPOSITION`  
**Scope:** read-only architecture/source review. No tests were requested or run; no source was changed.

## Summary

The two contracts correctly reject the tempting but unsafe shortcuts: the accepted Laya factory is not a production epoch authority, System Monitor is not a reservation allocator, and the existing C02 queue ledger is not a complete inventory of non-C02 filesystem commitments. Both proposed foundations are acceptable only as unavailable-by-default internals. They must not be composed into Laya “current authority” or C05 dispatch readiness until the blockers below and the explicitly missing writer participation are addressed.

## Findings

### 1. A main-process Laya epoch cannot fence independent process commits by itself

The accepted advisory service captures an epoch, awaits authority/provider work, rereads the authority and deployment gate, then synchronously checks the epoch immediately before its journal/cache commit. The composition packet injects one synchronous epoch reader to the service and provider, but the production epoch owner/reader is absent. Existing authority surfaces have separate commit mechanisms: cloud jobs use SQLite `BEGIN IMMEDIATE`; Vertex task state uses `SafeJsonFile`; root enrollment uses a cross-process lock plus atomic JSON persistence; System Monitor publishes `status.json` from a separate Python process; agents also have live process/session facts. These do not currently share one commit lock or revision authority.

**Race:** let an external producer finish a status/task/agent-state commit after the advisory's final asynchronous source reread but immediately before the synchronous epoch read and journal/cache publication. The in-process coordinator was never notified; unless the final synchronous read participates in a serialization protocol with that external writer, it can still return the old/unchanged in-memory epoch and allow a suggestion based on the pre-commit snapshot to publish. Durable per-source revision rereads detect commits that already happened before the read, but cannot alone order a concurrently committing external writer against the following journal/cache write. “Synchronous pre-visible-commit invalidation” is implementable for same-process writers, not automatically for these separate processes.

**Required correction before all-surface composition:** document and implement a cross-process linearization mechanism for every such source (for example, a shared lock/fence held across final source validation and publication, or a genuinely common transactional authority). Otherwise state explicitly that the coordinator only fences enrolled in-process writers, keep the all-surface reader unavailable, and do not call cross-process snapshots current/atomic. A post-commit event or timestamp is not a substitute for this ordering. The bounded coordinator task is safe only if its result remains a test/internal reader and cannot be passed as a production all-surface reader.

### 2. The existing capacity sample is not atomic with either claim or start authorization

The capacity contract correctly proposes one `cloud-jobs` SQLite reservation authority and says claim and start-permit admission must recheck it inside their own immediate transactions. Current source confirms that this integration is still missing: `claimWorkerJob()` reads only the C02 `cloud_capacity_reservations` sum inside its transaction and uses a previously sampled worker capacity value; `authorizeWorkerStart()` likewise reparses a caller-provided `capacityInput`, rechecks only C02 reservation rows, and validates sample age. The collector's two equal external-reservation reads establish consistency only during sampling; they do not bind that sample to a later claim or start transaction.

**Race:** sample disk free space and external revision R; a non-C02 producer inserts a reservation at R+1; then C02 claims using the old `externalReservedBytes` sample. The collector cannot prevent this interleaving. A later start check must also observe current non-C02 reservations, not merely the old sample and C02 rows.

**Required correction before claims are allowed:** expose an in-transaction ledger read/sum that can be used inside the already-open C02 `BEGIN IMMEDIATE` transaction (avoid an API that starts a nested transaction). Claim and start authorization must compute availability from the sampled physical `freeBytes` plus the current C02 and non-C02 rows in that same transaction, with exact device/filesystem binding and overflow refusal. Producers must reserve before disk side effects in that same database; they must release only after exact cleanup proof. Add a barrier regression that inserts a reservation after collection but before claim, and another between claim and start; each must serialize and refuse overcommit. Until those call paths are changed and verified, the ledger is not a claim/start fence.

### 3. “Complete non-C02 coverage” must be owned, not inferred from ledger contents

The inventory is supported: current durable future-byte reservations are C02 rows; System Monitor's sample and `admit --reserved-bytes` are observational/calculation-only; other registries reserve process/work slots, not disk bytes. Generic agents, build/automation processes, monitor activity, and other code can still write to the worker's shared filesystem without participating in a disk-byte API. An empty external ledger therefore means “no registered rows,” not “all other disk writers reserve zero.” The contract correctly calls for unknown participation to remain unavailable, but implementation needs a trusted, constructor-owned expected participant set and explicit participation/disablement proof. A producer-supplied name, the existence of the table, or `complete:true` cannot establish coverage.

**Required correction:** reserve/release APIs must accept only enrolled producer identities; coverage is available only when every allowed writer for the exact device/filesystem is enrolled or technically excluded from those paths while dispatch is enabled. A producer that fails to register or loses its authority makes coverage unavailable. Keep C04 status and the existing private `worker-capacity.json` reader out of the role of complete reservation authority unless a separately reviewed trusted producer actually writes the required evidence.

### 4. Two source slots are verified; the Adam/Friday-to-slot mapping is not

The source schema fixes `HERMES_PROFILE_IDS` to `hermes-1` and `hermes-2`; `validateHermesProfileRegistrations()` requires exactly one of each and distinct homes/worktree IDs, and bootstrap checks physical directory identity and verification fields. The reports and user instruction identify Adam and Friday as the two requested heads. The source-level slot validator does not itself establish which existing head owns which slot, nor does it prove either live profile, account, auth, or process is enrolled. Keep the source claim at “exactly two distinct slots”; preserve the user-approved Adam/Friday mapping in the trusted enrollment configuration and verify it through ROOT's separate live gate. No tab/config/account was accessed or changed for this review.

## Validated contract evidence

- **Laya:** `laya-authority-epoch.ts` only validates/captures a scalar ticket; it does not own writer revisions. Service/provider rechecks and final synchronous epoch check exist in source. The accepted two-file composition remains `64e28b6634c018c5cc16d7b0a1a87500c9083157a795bdc30f38c1ab8b7e477a`, explicitly not wired/deployed. `root-local-delivery.json` reports `providerActivated=false` and keeps quality evaluation open.
- **Capacity:** `database.ts` opens the single cloud-jobs SQLite DB and `cloudTransaction()` uses `BEGIN IMMEDIATE`. Existing C02 claim/start logic reserves and rechecks C02 rows there. `cloud-worker-capacity-collector.ts` double-reads strict external snapshots and descriptor-binds the physical Linux sample, but is not wired and does not create reservations. The current capacity reader in main is a private receipt reader with no writer. Root receipt says `workerConfigured=false` and `externalReservationsAuthorityExists=false`.
- **Enrollment:** `hermes-1` and `hermes-2` are the exact source slots, with distinct homes/worktrees checked at registration/bootstrap. This is not a live profile or provider acceptance.

## Evidence reviewed

Canonical repo `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`; pre-existing dirty/untracked files were preserved. Reviewed `dobius/AGENTS.md`, the current build plan, both contracts and next-task briefs, current BUILD1/BUILD2/root receipts, Laya epoch/service/provider/composition, cloud-jobs database/claim/start ledger/capacity collector, System Monitor producer, Vertex task store, root enrollment store, agents store, and Hermes slot schema/registry/bootstrap validation. No tests were run because this was an architecture-only review. No private credentials, original content, services, provider, device, network, AWS, or historical Storage operations were used.

Exact SHA-256 evidence is recorded in `research.json:integration-contract-review-20261014`; the checked contract hashes were BUILD1 `f9c30db3f2432a2270bd7a536ab35fb2d5900c818a81f4eb52bf307f826a9b3f` and BUILD2 `da0c2259502caacad147c305cec37dac45ed1d0bf5ed7ad66d46cd871aeebc04`.
