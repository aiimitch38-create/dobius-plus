# Independent ADAM approved-payload v2 review

**Task:** `task_b7c711b49a88`  
**Dispatch:** `ctx_5503e6b8d61e`  
**Repository:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`  
**Verdict:** `PASS_BOUNDED_CANDIDATE_SOURCE`

## Exact freeze

Reviewed only `plans/worker-monitor-20261014/adam-approved-payload-candidate-v2`. The 17-file manifest SHA256 is `31a4771906a3da0b7f0e082dbf0e29f091971c8e0567eb6bd142e7423d547d1f`; the candidate patch SHA256 is `0aa3d4ce20176d31f2e02205e225047a03c800b3831672116a9a812917d4227d`. I recomputed every listed file hash and byte count; all 17 match. The frozen Dobius fingerprint sources remain `cloud-jobs.ts` `49d61c89d6688a928839b598bbee90b4053cdd3b8c807d027087b4cb3a0d8348` and `cloud-job-adam-receipts.ts` `4d161a0f33309d551b9b863e47e2dfdb4764854af5bf3be98ea3bb8c3e3dd49b`.

## Review result

The v1 project mismatch is closed at all three boundaries:

- `service/src/dobius-cloud/approved-job-payload.ts`: `parseApprovedJobIntent` now requires `approvedJob.projectId === request.projectId` after bounded strict parsing and before returning to the sealing path. The approved-payload digest is still required to equal `requestFingerprint`.
- `service/src/dobius-cloud/intent-publication.ts`: duplicate/recovery validation reparses persisted canonical payload text and requires its project to equal the request project, with both persisted digest and fingerprint matching. The approved duplicate path also requires the stored JSON/digest to equal the current approved payload before returning `existing`.
- `service/src/dobius-cloud/receipt-store.ts`: consume reparses the persisted payload and requires project equality with `binding.projectId`, plus digest equality with both stored digest and binding fingerprint. This remains before the exact-consumed replay return, so tampering does not bypass validation on replay.

The new tests cover a freshly fingerprinted A-parent/B-payload refused before sealer invocation or writes, and persisted cross-project payload corruption with a recomputed digest refused on duplicate and consume. Existing intent tests remain byte-identical to v1, preserving the 13 prior regressions. The candidate test suite has eight approved-payload cases plus one canonical fingerprint parity case.

Other reviewed contract points remain sound for this bounded candidate: the strict `CloudJobInput` mirror and canonical SHA256 agree with the exact Dobius sources; input is bounded canonical UTF-8 text checked before parse/seal; migration v20 adds nullable columns without backfilling legacy approval; binding, intent and approved payload publish in one transaction after sealing and after freshness/expiry rechecks; legacy identity-only rows remain non-executable; unchanged exact duplicate/reopen does not reseal or renew expiry; consumed replay is exact and non-renewing, while an unconsumed expired grant is refused; plaintext capability is not stored and failure errors are reduced to stable codes.

## Evidence and limits

No tests were run during this independent review. The exact v2 author receipt `build2.json#adam-approved-payload-candidate-v2-resume-20261014` records Node 24.18.0: 22 focused tests passed (13 original intent, 8 payload, 1 parity), strict TypeScript passed, and `git apply --check` passed against temporary baseline copies. This review independently verified the frozen bytes and inspected the relevant source and tests.

The candidate remains unapplied to the external ADAM checkout. No ADAM DB, migration, service, planner, sealer, credential, profile, account, live runtime, or provider was accessed. This verdict is source-candidate review only; authorized application, native ADAM migration/tests, and any runtime/production acceptance remain outstanding.
