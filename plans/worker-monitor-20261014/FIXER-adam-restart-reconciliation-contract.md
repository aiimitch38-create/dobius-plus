# FIXER ADAM restart reconciliation contract

Date: 2026-10-14  
Task: `task_084c674e3bd6`  
Dispatch: `ctx_8efa3dac6aa0`  
Repository: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`  
Branch: `fix/channel-cost`  
Verdict: `PASS` (source-only preflight; implementation remains outstanding)

## Scope and method

Read-only source preflight for the next ADAM restart-reconciliation integration. No source changes, test execution, runtime calls, private credential/config reads, Git mutations, service starts, or live activation were performed. Interactive Hermes Adam and Friday tabs/configuration/accounts were not inspected or changed. The service source reviewed is `/Users/bayou/dobius/projects/ADAM/service/src`; this is the local ADAM service, not the interactive Hermes Adam.

## Authoritative state and current gap

Dobius owns the authoritative child job and its consumed binding in its cloud-job SQLite database. The `cloud_job_adam_bindings` row retains the exact binding ID, ADAM instance, parent ID/version, project/context digest, request fingerprint, binding digest, and expiry. It does not retain the grant capability. The catalog facade `CloudJobCatalog.findAdamBoundChild(approvedInput, consumedBinding)` performs the reviewed SELECT-only recovery lookup against the catalog's own database. It can recover a committed child after binding expiry/reopen and refuses an exact binding attached to another creator or mismatching approved input. Existing focused tests cover those cases and unchanged binding/event/outbox state; no tests were run in this preflight.

The Dobius `cloud_job_adam_receipt_outbox` is an outbox for event receipts after a child job/event exists. It is not a pending child-submission intent. Its drainer leases and retries those event receipts; it cannot decide whether an ambiguous submit should be sent again.

ADAM service `DobiusCloudReceiptStore` owns binding issuance/consumption and received event receipts. It stores only a hash of the capability and the immutable identity JSON for an issued binding. On successful consume it stores the exact response JSON and returns that exact response on a same-capability replay before expiry/current-parent validation. For an unconsumed expired grant, it refuses. The receipt table records event receipt observations and duplicate receipt acknowledgements; it does not mutate the parent. No durable child-submit intent/outbox, original request body, or service-side submit caller was found in the reviewed ADAM source. The service grant issuer appears only as a store API; no service callsite issues grants in the inspected source.

Therefore a lost submit acknowledgement can leave an ADAM caller unable to know whether Dobius committed the child. After the binding expires, the ordinary admission path cannot simply consume again: `CloudJobAdamClient.consumeBinding` applies the expiry check. Although the exact child lookup exists, current submit admission does not call it before attempting a retry, and current ADAM service source has no durable retry caller. This preflight identifies the missing composition; it does not claim the future integration is implemented.

## Existing call chain and integration callsites

1. Dobius exposes the local CLI command `dobius submit-adam-child --request-stdin [--json]`. Its `src/cli/handlers/adam-cloud-child.ts` handler reads a bounded JSON envelope from stdin and calls the local RPC. The grant is not carried in argv.
2. The existing Dobius main-process RPC handler at `src/main/runtime/rpc/methods/adam-cloud-child.ts` requires authenticated-local socket context and no paired/device/client identifiers, fixes the principal to `adam-parent-planner`, and calls `CloudJobService.submitAdamBound`.
3. `cloud-job-service.ts` routes through `cloud-job-submit-admission.ts`: normalize and validate the approved input and authority, consume the binding through the ADAM client, then submit through the catalog.
4. `CloudJobCatalog.submitWithBinding` transactionally deduplicates on creator plus request key/fingerprint, records the child and consumed binding, and writes the submitted event/outbox receipt as part of the same store transaction.
5. Existing local ADAM `service/src/adapters/dobius.ts` wraps status/terminal/repository CLI operations but has no stdin child-submit method. `service/src/runtime/service.ts` starts ordinary reconciliation and periodic orchestration ticks; neither is a cloud child-submit recovery hook. `AuthoritativeOrchestrationSupervisor` startup sweep is for its orchestration jobs and does not reconcile cloud child submissions.

A future autonomous ADAM service integration would need a typed adapter method over the existing stdin CLI envelope, called by a durable child-submit intent worker. That future worker should use the existing Dobius private/local command path; this bounded Dobius client/admission slice adds no ADAM caller or RPC, main-process, or runtime edits. Any later runtime lifecycle wiring should be separately owned/reviewed.

## Future durable intent and recovery order

The following durable-intent design is a future ADAM service integration, outside the bounded Dobius client/admission slice assigned on 2026-10-14. The assigned slice assumes the caller still holds the exact original grant and approved input; it is not autonomous restart recovery. The ADAM consume endpoint already returns the exact previously consumed response before expiry checks, so replay requires no new route or ADAM service change.

For a later autonomous service integration, ADAM would need a durable child-submit intent before the first external submit. A dedicated service module/table (candidate: `service/src/dobius-cloud/child-submit.ts`) should bind one immutable record to the binding ID, exact parent ID/version, ADAM instance, context identity, stable request key, canonical approved request and its fingerprint, and sealed capability. Persist intent status/lease/attempt metadata and, once known, the child ID/result. Create the grant and its pending intent atomically in the ADAM database, or use an equivalent transaction that cannot leave an issued capability without a durable owner.

The current ADAM receipt store intentionally keeps only a one-way capability hash. The retry worker therefore needs an approved OS-backed secret sealer for capability-at-rest storage. Do not put the raw capability into SQLite, logs, CLI arguments, or reports. If a suitable sealer is unavailable, fail closed before issuing a grant; do not invent an ad hoc encryption scheme. Reuse existing project secret-storage facilities only after their concrete API and ownership are reviewed.

For every ambiguous submit/retry, the intended sequence is:

1. Load and validate the durable intent; keep principal fixed to `adam-parent-planner`, and keep the canonical approved input, request key, creator, binding ID, parent identity/version, ADAM instance, and context identity unchanged.
2. Use the existing authenticated ADAM consume endpoint with the original capability and identity. Its current implementation returns only the exact stored response for an already-consumed grant before checking expiry; it refuses an unconsumed expired grant. The recovery-specific behavior belongs in the Dobius client and must not weaken ordinary `consumeBinding` freshness checks or create a fresh grant to mask an ambiguous outcome.
3. Call `CloudJobCatalog.findAdamBoundChild(approvedInput, consumedBinding)` through `CloudJobService`/admission before any retry submission. If it returns a child, record that child as reconciled in the ADAM intent and return success without submitting again.
4. If lookup returns null, only submit the same stable request key, canonical input, and consumed binding while the original approval remains valid. Catalog idempotency then protects concurrent/replayed calls. If the grant is expired, refuse and move the intent to explicit reapproval; do not mint a replacement or silently create a second child.
5. If lookup throws for a binding, creator, or request mismatch, mark the intent blocked/needs operator review and never fall through to submit. Preserve evidence and avoid mutating the child, binding, event, or receipt ledgers during lookup/refusal.
6. On endpoint/auth epoch change, timeout, malformed response, or transport failure, leave the intent ambiguous/retryable. Existing `CloudJobAdamTransport` checks the current authorization epoch around token resolution and HTTP exchange and discards a result if it changed. Never persist/reuse an auth token or treat a stale epoch as proof of success. The binding's ADAM instance remains pinned; a different current service instance must refuse the exact binding.

Initial admission should also place lookup immediately before submission whenever it has the consumed binding, so a retry cannot bypass reconciliation. Maintain lookup and eventual submission in one controlled service flow; do not expose a raw catalog submit path to the retry worker.

## Refusal semantics

- Missing, corrupt, unsealable, or identity-inconsistent intent: fail closed; no submit.
- Exact consumed response unavailable: no submit; retain intent as ambiguous or require reapproval according to whether the binding remains valid.
- Expired and not previously consumed grant: refuse; explicit new parent approval is required.
- Expired but previously consumed grant: the existing authenticated consume endpoint can return its exact stored response; the Dobius recovery client may accept that response only when its `boundAtMs` is before expiry, then lookup must run before any possible resubmit.
- Lookup finds child: return the existing child and mark recovered; do not append another event or receipt.
- Lookup returns null under a still-valid exact binding: submit only the same request once/idempotently.
- Lookup refuses creator/binding/request mismatch: block; never treat refusal as null.
- Auth epoch/endpoint mismatch or transport uncertainty: retain ambiguous intent; recover under the current epoch only after exact instance/identity checks.
- Duplicate receipt delivery: preserve existing receipt-store behavior (same receipt identity/payload returns duplicate acknowledgement); it is independent from child-submit reconciliation and must not mutate the parent.

## Ownership proposal for a future autonomous service integration

- FIXER / Dobius recovery owner: `src/main/automations/cloud-jobs/cloud-job-adam-client.ts`, `cloud-job-submit-admission.ts` and/or `cloud-job-service.ts`, catalog facade use, and focused tests. Preserve the established `CloudJobCatalog.findAdamBoundChild` API. Add no public RPC for this recovery path.
- ADAM service owner: new durable intent/outbox module and schema/migration under `service/src/dobius-cloud/`, recovery worker/hook in the service lifecycle, capability sealing integration, and a typed stdin submission method in `service/src/adapters/dobius.ts`, with temporary SQLite tests.
- ROOT/runtime owner if later required: separately review any startup/lifecycle or RPC/CLI wiring. Current task authorizes no such edits.

## Deterministic temporary-fixture tests for a future full service integration

The following tests would cover durable ADAM intent and restart behavior, which is outside this assigned slice. Use real temporary SQLite files for ADAM service and Dobius catalog state, deterministic fake clocks/transports/adapters, and no live services or credentials:

1. Lost acknowledgement after commit: submit once, commit child/binding/submitted event/outbox, discard the client acknowledgement, close both databases, advance beyond expiry, and reopen. Exact consumed-binding replay plus `findAdamBoundChild` must return the original child. Assert one child, unchanged request key/fingerprint/binding, no second submit, and unchanged event/outbox counts after recovery.
2. Expired consumed grant with no committed child: close/reopen and advance past expiry; exact stored response can be replayed for lookup, lookup returns null, and recovery refuses for reapproval without child/event/outbox creation or parent mutation.
3. Fresh unconsumed grant: lookup returns null and one submit creates one child; concurrent/replayed same-key calls return the same child ID and do not duplicate rows/events/outbox entries.
4. Misowned binding and changed approved input/fingerprint: lookup refusal blocks the worker and proves its submit adapter was never called; compare binding/event/outbox snapshots before and after.
5. ADAM receipt lost acknowledgement: resend exact receipt ID/payload after restart, receive the duplicate acknowledgement and retain exactly one receipt row; verify parent state is unchanged.
6. Transport epoch/endpoint change and timeout at each await boundary: no intent is marked complete and no second identity is minted; recovery under the same pinned ADAM instance remains deterministic, while a different instance refuses.
7. ADAM migration and transaction rollback: create/reopen from the prior schema with existing receipt/binding rows, verify the new intent schema preserves them, and inject failure between grant and intent writes to prove neither orphaned authority nor partial state survives.

## Reviewed source freeze

Hashes below are SHA-256 of exact source bytes observed during this preflight. These hashes identify the reviewed tree; they are not a Git commit or packaged/live acceptance.

Dobius repository:

- `dobius/src/main/automations/cloud-jobs/cloud-job-catalog.ts` — `0956b0fad9b248e5f044b934dee1c61c232a6685554ce5933afe42e994b77489`
- `dobius/src/main/automations/cloud-jobs/cloud-job-adam-child-lookup.ts` — `a8cd25c3410b404781ab4f7bc417b2e0ce292c89150fdfcf41e28ceab1ae1480`
- `dobius/src/main/automations/cloud-job-submit-admission.ts` — `586d9edaa14a49095e39a80f32ddc7e71dbdc0d1e52ffa129829fa3ee13b6bb1`
- `dobius/src/main/automations/cloud-job-service.ts` — `b363a06fc51ace6225a005c863b06726d172407049e6880a0dc14e686554c440`
- `dobius/src/main/automations/cloud-job-authority.ts` — `68c2b71503572c895482718fe5c3aacf386e6e63d645c9f433102704db599ed7`
- `dobius/src/main/automations/cloud-jobs/cloud-job-adam-client.ts` — `f3e8a8574dbc2ef3895085891d7604df3f6cd47c287e8287edde62f91bef1a8b`
- `dobius/src/main/automations/cloud-jobs/cloud-job-adam-transport.ts` — `74d278505b3548788ac2cb599b2ce74ded1cd07b037daa28fdc6ef1f20b0c312`
- `dobius/src/main/adam-authorization-epoch.ts` — `eb7d8e30a78976db99107bd43312572f81417af08d13a3921db3e61b909ab981`
- `dobius/src/main/automations/cloud-jobs/cloud-job-adam-outbox.ts` — `15c8c93691dc80bafe9b537dfa51189525f1ce68f846453b9b27f6f42ac78927`
- `dobius/src/main/automations/cloud-jobs/cloud-job-adam-outbox-lease.ts` — `d3af9ece24a391be8be3ebd2bdd9e269f8c0b93b35ef4c6e47743062896444c9`
- `dobius/src/main/automations/cloud-jobs/cloud-job-adam-drainer.ts` — `101df3f12471c90ef997a54b1cbfdd8af376498d49e8ef2f35b55f1f678fcd0b`
- `dobius/src/main/automations/cloud-jobs/cloud-job-adam-outbox-schema.ts` — `883fae5a1a664d6d3d06842b171915d18e9daf1e48dd0e9612b2b7e39a861738`
- `dobius/src/main/runtime/rpc/methods/adam-cloud-child.ts` — `c240dc87f192adf5ac4bfb114c86c3d5de82e5db65cf11c33b12c3d33866edbc`
- `dobius/src/cli/handlers/adam-cloud-child.ts` — `5ce71e3623bc7a3d72a961fb73bfbaf503e60e1d43688c894a433384d4bfff11`
- `dobius/src/cli/specs/core.ts` — `8d095fe709df40083c97c95612b6b4c3ea4064517b12b9ab41eaaa56fcd5fee1`
- `dobius/src/shared/cloud-job-adam-submission.ts` — `25c7ccdd2c41d4a30364df3890b887ff45509ea95b4d1a650efd98a382db46e1`
- `dobius/src/shared/cloud-job-adam-receipts.ts` — hash not frozen in the prior source pass; not needed to assert the bounded caller gap.

ADAM service source root `/Users/bayou/dobius/projects/ADAM`:

- `service/src/dobius-cloud/receipt-store.ts` — `7f49efb0be1e500873b196ccb12478f19aa22e8d1167e7a465811a2dce4cf9a1`
- `service/src/dobius-cloud/receipt-migration.ts` — `c002f814316756bae64bd6e77ac72503c87013b22e8bfad43a1091626984e5dd`
- `service/src/dobius-cloud/receipt-contract.ts` — `7cdbfb8624e824311e29f71bb529d02aff2e0a04a76fc72621f11e3a43e45f51`
- `service/src/runtime/service.ts` — `251b62dd624918e43c27cdaa37ca02a7e3d21c72162fe92ff681196826504862`
- `service/src/db/database.ts` — `f72d88a8c29d59695b05a02d03b3e2d8e70a56346f9965e84bd7146dec319c91`
- `service/src/db/migrations.ts` — `fc986082dae3175742421c5e3489370032e0c498b00d9de9a39b9adcd2c5954e`
- `service/src/main.ts` — `58159e34ecb3948a2ce809429b92a7da8a484d5683f27eae2bd556ce8bcad066`
- `service/src/orchestration/supervisor.ts` — `7fdf98cc1be184f3fd2701f0281524f1397866e491a4c8cb6fed6be61a2ff0cf`
- `service/src/supervisor/supervisor.ts` — `233f078a47569e1ef1d3495a9b2234863371320a6c6eca1b517b92e19072e84a`
- `service/src/adapters/dobius.ts` — `6b5167cad2534c50a68490d07aaef272850a4f1087340b9af74f2c97a87a079b`
- `service/src/jobs/store.ts` — `e155bdf80a037a1de17364e0a9865941932b19a9f02717d0864f8084a80feb46`

## Limitations and acceptance boundary

At the time of the original source-only preflight, no tests, lint, format, typecheck, builds, installs, service calls, migrations, production data, credentials, providers, devices, RPCs, or runtime activation were performed; the catalog facade evidence cited there was previously independently reviewed. The later bounded client/admission implementation has its own focused test, lint, and format evidence recorded in `plans/cloud-workstation-reports-20261012/fixer.json#adam-recovery-aware-submission-20261014`. Neither stage establishes autonomous restart recovery, durable ADAM intent, protected capability storage, packaged acceptance, or live acceptance. The future full-integration fixture plan above remains a separate prerequisite for any later ADAM intent/worker implementation.


## Review correction (2026-10-14)

The source review confirmed ADAM `DobiusCloudReceiptStore.consume` already returns its exact stored consumed response before expiry validation, while an unconsumed expired grant refuses. No ADAM route/store change is required for exact replay. The current assigned work is limited to a recovery-aware Dobius client and lookup-before-submit admission for a caller retaining the original grant; it does not add durable intent, capability sealing, or autonomous restart recovery. The drainer hash in the inventory above is corrected to the reviewed current source bytes.
