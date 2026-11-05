# ADAM approved-job payload persistence: implementation contract and blocker

Task `task_6ad060f67b64`, dispatch `ctx_ee1c5d4d532e`. **Source implementation was not performed:** the required ADAM checkout is `/Users/bayou/dobius/projects/ADAM/service`, outside this session's writable root (`/Users/bayou/Projects (Code)/Dobius`). I made no ADAM source or test changes. The requested `build2.json` and this contract are the only files written.

The exact Dobius request/fingerprint contract is inspectable and can be mirrored without inventing payload compatibility, provided the mirror is explicitly pinned and guarded by a shared golden vector. `dobius/src/shared/cloud-jobs.ts:14-29` defines strict `CloudJobInput`: `requestKey`, `taskId`, `projectId`, `workspaceId`, `targetDeviceId`, `recipeId`, trimmed `title`, lowercase 40/64-hex `sourceRevision`, safe nonnegative integer `estimatedBytes`, and up to 50 `dependencies` (default `[]`). `dobius/src/shared/cloud-job-adam-receipts.ts:133-177` hashes UTF-8 canonical JSON with recursively lexicographically sorted object keys and SHA-256, with a 64 KiB canonical byte cap. ADAM's `receipt-contract.ts` has the same canonicalization structure and size cap; it uses Node crypto SHA-256 instead of `@noble/hashes`, both standard SHA-256 over the same canonical bytes.

## Smallest safe source change

Add `service/src/dobius-cloud/approved-job-payload.ts` with a strict mirror schema and parser for a **canonical JSON string**, not an arbitrary object. Requiring a string avoids executing caller getters/proxy traps during inspection; bound UTF-8 bytes before parsing, parse with `JSON.parse`, validate the strict schema, apply the same title trim and dependency default, then canonicalize. Require the submitted payload string to equal the resulting canonical string; this rejects duplicate-key/noncanonical representations, unknown keys, coercion, and data that changes under normalization. Compute the digest with the existing ADAM canonical SHA helper and require exact equality with `intent.requestFingerprint`. Add a fixed golden fixture shared with Dobius tests so any schema, trimming/default, key ordering, UTF-8 encoding, size, or digest drift fails before publication. `contextDigest` remains separately bound in the intent identity; do not conflate it with the payload fingerprint.

Extend the existing v19 intent table with a v20 migration adding nullable `approved_payload_json` and `approved_payload_digest` columns. Null/null means legacy identity-only and is permanently unavailable for execution; only one-null is malformed/refused. Do not backfill old rows. Legacy intent and binding records remain readable for existing receipt/expiry behavior but cannot be upgraded into approved execution by a matching fingerprint.

Add an explicit `issueApprovedJobGrantWithIntent` path in `receipt-store.ts` / `intent-publication.ts`. It validates the bounded canonical string and fingerprint before calling the sealer. The existing publication sequence remains: seal outside the SQLite writer transaction, then `BEGIN IMMEDIATE`, re-read instance/parent/intent, and atomically insert binding plus intent including canonical payload and digest. If a competing publisher already committed, return the existing non-secret identity only after checking the stored payload bytes/digest and every current intent/binding identity field against the request; never reseal, extend expiry, mint a second job, or return capability bytes from the duplicate path. A new API duplicate that finds null legacy payload columns must return a typed unavailable/conflict result without backfill. On transaction failure the binding, intent, and payload remain all-or-nothing.

Keep the existing identity-only publication API behavior only for compatibility if other internal callers require it; mark those rows non-executable and ensure the new approved-execution path refuses them. No HTTP route, planner producer, job submission, or live sealer is added by this persistence slice.

## Required regression coverage

Extend `service/tests/dobius-cloud-intents.test.ts` for: exact Dobius golden payload/fingerprint; max-size and oversize; unknown fields, changed/trimmed title, missing/default dependencies; malformed JSON, duplicate keys/noncanonical key order, unsafe numeric values and non-JSON inputs rejected by the string-only API; mismatch among payload fingerprint, parent/version, project/context, intent instance; one transaction rollback when payload or intent insert fails; concurrent same-intent publication with only one row pair and same non-secret identity; reopened duplicate exact payload with no reseal/renewal; changed payload duplicate refused; legacy identity-only row remains unavailable and unchanged; payload/digest pair corruption refused; persisted capability absent from DB/WAL/errors. Keep the existing intent suite's expiry, parent-change, instance/reopen and receipt semantics intact. Run only that focused Node test file after source access is available.

## Source state and exact hashes

These hashes are the unchanged source bytes inspected in this dispatch. The ADAM worktree already reports the listed migration as modified and the intent/receipt implementation and test files as untracked; they were preserved. “Before = after” means this dispatch did not mutate those files.

| File | Before SHA-256 | After SHA-256 |
|---|---|---|
| `service/src/dobius-cloud/intent-contract.ts` | `60d148b77864bb83025e1d8cfeb6f0b3883d3d995759df306fbce165880a7ecd` | unchanged |
| `service/src/dobius-cloud/intent-publication.ts` | `9cb9e986979a61a9ad7eba5fb9c9a46cbe63a849e5ad39e8264270fea1d12ba8` | unchanged |
| `service/src/dobius-cloud/intent-migration.ts` | `ce3c0b4bcc37e392361d08dbc04ab02a2d284c979a027e59400f52be092ef93e` | unchanged |
| `service/src/dobius-cloud/receipt-store.ts` | `04d066e92024af51ed4e19cc58954f61bfc5c975d29fdcb0dc079c48b0dbc9c3` | unchanged |
| `service/src/dobius-cloud/receipt-contract.ts` | `7cdbfb8624e824311e29f71bb529d02aff2e0a04a76fc72621f11e3a43e45f51` | unchanged |
| `service/src/db/migrations.ts` | `e54ea453716a30c938fb01a9f4f24658b0e257505a781e4ec20394f070adc26e` | unchanged |
| `service/tests/dobius-cloud-intents.test.ts` | `e06aa74c4c67d3ba4a2aa158cb03dd37c5ebe5aed422a2393c2036ccdcc6c128` | unchanged |
| Dobius `dobius/src/shared/cloud-jobs.ts` | `49d61c89d6688a928839b598bbee90b4053cdd3b8c807d027087b4cb3a0d8348` | inspected read-only |
| Dobius `dobius/src/shared/cloud-job-adam-receipts.ts` | `4d161a0f33309d551b9b863e47e2dfdb4764854af5bf3be98ea3bb8c3e3dd49b` | inspected read-only |

No tests were run because source editing and test execution in the external ADAM checkout are outside this session's writable scope. No database, service, credential, profile, or account data was opened; only source and Git status for the exact owned ADAM paths were read. This task does not add a live producer, route, sealer, or execution authority.
