# Independent ADAM approved-payload candidate review

**Task:** `task_fd930da7b5f4`  
**Dispatch:** `ctx_139a7d7868db`  
**Repository:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`  
**Verdict:** `CHANGES_REQUIRED`

## Freeze checked

Reviewed the final 17-file candidate at `plans/worker-monitor-20261014/adam-approved-payload-candidate`. Its manifest SHA256 is `9a17044c9c54fa4b915d57d5a3b4b04021b7c81d843c41211387e584f2703e9f`; the contained candidate patch SHA256 is `bf6eb2298422c647e89ddd2e856bd0094ff132a72723b4c93d67d26f58bf654d`. Independently rehashed all 17 entries and checked their byte counts: all match. The two canonical Dobius sources also match the freeze: `dobius/src/shared/cloud-jobs.ts` `49d61c89d6688a928839b598bbee90b4053cdd3b8c807d027087b4cb3a0d8348`; `dobius/src/shared/cloud-job-adam-receipts.ts` `4d161a0f33309d551b9b863e47e2dfdb4764854af5bf3be98ea3bb8c3e3dd49b`.

The earlier 16-file manifest is superseded; this review applies only to the final manifest above. The patch changes six intended ADAM service paths. This remains a candidate under the Dobius repository and was not applied to the external ADAM checkout.

## Finding

**Approved payload project is not required to match the project authorized by its parent intent.** In `service/src/dobius-cloud/approved-job-payload.ts`, `parseApprovedJobIntent` verifies that `requestFingerprint` equals the canonical digest of `approvedJob`, but does not compare `approvedJob.projectId` to `request.projectId`. In `service/src/dobius-cloud/intent-publication.ts`, `assertParent` checks the parent’s project against `request.projectId`, and the binding identity records that request project, but the approved payload itself is stored and later consumed without this cross-field check (`service/src/dobius-cloud/receipt-store.ts`, approved-payload consume validation). Therefore a canonical request can authorize parent/project A while embedding a correctly fingerprinted child payload for project B. The digest proves payload integrity, not that the child belongs to the authorized parent project.

**Required correction:** reject unless `approvedJob.projectId === request.projectId` before sealing, and add a regression with a real synthetic parent in project A and an otherwise valid, correctly fingerprinted payload in project B. Assert refusal before sealer invocation and no binding/intent publication. Keep the current digest, parent revision, context, instance, transaction and replay checks intact.

## Confirmed bounded behavior

- `approved-job-payload.ts` mirrors the actual Dobius `CloudJobInput` field set, CloudId rules, title trim/min/max, source revision format, estimated byte integer/range, dependency cap/default, and strict unknown-key rejection. Canonical SHA256 uses the same recursively sorted JSON scheme as the two frozen Dobius sources.
- The approved-intent parser accepts bounded UTF-8 text only, checks byte size before JSON parsing, rejects invalid UTF-8 round trips, parses strict schemas, and requires byte-for-byte canonical JSON equality. This rejects duplicate-key JSON and noncanonical encodings before sealing.
- The binding identity includes ADAM instance, parent ID/revision, project, context digest, payload fingerprint and expiry. The payload fingerprint is carried in the binding. The missing semantic equality between payload and binding project is the finding above; the opaque context digest’s authoritative construction remains the planner/caller’s responsibility.
- `issueApprovedJobGrantWithIntent` validates before sealing; publication rechecks the stable intent, ADAM instance, parent project/revision/state, and expiry in the transaction that writes binding, intent, payload JSON and digest. Concurrent publication rechecks the exact existing row; duplicates do not reseal or renew expiry.
- Consume refuses legacy identity-only rows and tampered/mismatched payload JSON or digest. Exact consumed replay returns the persisted response without renewing TTL; an unconsumed expired binding is refused. The v20 migration adds nullable payload/digest columns, preserving old rows without implying approval.
- Error paths map sealer and publication failures to bounded `CloudReceiptError` values. Capability is stored as a hash plus sealed envelope; the code rejects a sealer result containing the literal capability. The reviewed tests include the existing 13 durable-intent regressions, six approved-payload cases, and one Dobius/ADAM fingerprint parity case.

## Verification and limits

No tests were run in this independent review, per the dispatch. The author receipt reports Node 24.18.0: 20 focused synthetic tests passed and strict no-emit TypeScript passed; those commands and the final candidate hashes are recorded in `build2.json` under `adam-approved-payload-candidate-final-freeze-resume-20261014`. The candidate test files retain the 13 intent cases plus the six new payload regressions and parity test. Review did not access the external ADAM checkout, credentials, live database, migration, service, route, planner, or sealer.

This is not ADAM implementation, migration acceptance, producer approval, service activation, or live execution acceptance. After the cross-project equality fix and its regression, obtain a new exact freeze/review and run native ADAM migration/tests in an authorized ADAM checkout.
