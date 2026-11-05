# RESEARCH independent review: ADAM restart reconciliation contract

Date: 2026-10-14  
Task: `task_36b45ad234f7`  
Dispatch: `ctx_982c39ecd129`  
Repository: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`  
Branch: `fix/channel-cost`  
Verdict: **CHANGES_REQUIRED** for the contract packet's source-hash inventory and recovery-path wording; the core replay/refusal ordering is supported by current source.

## Exact freeze and hash verification

The reviewed contract is `plans/worker-monitor-20261014/FIXER-adam-restart-reconciliation-contract.md`, SHA-256 `e6c2ab470297d0214fa87dbc40737fc6043896da917991e3da5f8745c4d295b3` (17,012 bytes). The corresponding receipt is `plans/cloud-workstation-reports-20261012/fixer.json`, SHA-256 `ca81168309ffa664fa830852fc44d497d9325710174c945c0f9a3d8525586929`; its `adam-restart-reconciliation-contract-20261014` entry identifies that exact freeze. I recomputed all 13 entries in that receipt's `reviewed_hashes`; all match current bytes, including both repositories' files.

The contract's larger “Reviewed source freeze” inventory has one incorrect hash: `dobius/src/main/automations/cloud-jobs/cloud-job-adam-drainer.ts` records `101df3f12471c90ef997a54b1cbfdd8af376498d49e3d4e1ed762c74fd9653f6df`, while current bytes hash to `101df3f12471c90ef997a54b1cbfdd8af376498d49e8ef2f35b55f1f678fcd0b`. This is a packet evidence correction, not a behavioral finding. The ADAM `service/...` inventory paths are rooted under `/Users/bayou/dobius/projects/ADAM`; their recorded hashes matched when resolved against that root.

## Behavior review

**Replay ordering is correct in the existing ADAM authority.** `service/src/dobius-cloud/receipt-store.ts` validates the exact capability hash, canonical stored binding identity, and current `adamInstanceId` inside its transaction. If `response_json` exists, it returns that exact stored response before parent-state and expiry checks. If no response exists, it validates the current parent and refuses `now >= expires_at_ms` before recording a consumed response. Thus exact replay of an already-consumed binding is supported today; an expired unconsumed approval remains refused. `service/src/runtime/service.ts` exposes this through the existing authenticated `POST /v1/dobius/cloud-job-bindings/consume` route. No ADAM route/store change is necessary for replay itself.

**The current Dobius client prevents the supported recovery case.** `cloud-job-adam-client.ts::consumeBinding` rejects an expired grant before transport and also rejects a response arriving at/after expiry. A separate recovery-only method can reuse the existing consume endpoint while validating the same grant, canonical request fingerprint, binding identity, response binding, and digest. It must omit only those local expiry gates needed to ask the server for its exact previously consumed response; the server remains authoritative for distinguishing consumed from unconsumed. Non-2xx, timeout, malformed/mismatched response, changed auth/endpoint epoch, and any other unavailable result must stay errors and must never become `null` or trigger ordinary submit.

**Authoritative child lookup exists but is not in admission.** `CloudJobCatalog.findAdamBoundChild` delegates to `findCloudJobAdamChild`, which performs an exact local read and rejects creator/request/binding mismatches. `cloud-job-submit-admission.ts` currently calls `consumeBinding`, checks current store/project, and immediately calls `submitAdamBound`; it does not lookup first. `cloud-job-adam-outbox.ts` rejects creation of a new bound submission at/after expiry. A null lookup therefore permits submission only while the original binding remains valid and current; a mismatch/lookup error must fail closed. Recovered child return must not write a second child event or receipt outbox row.

**Identity and epoch limits.** The immutable binding pins parent ID/version, project/context digest, request fingerprint, expiry, and ADAM instance; Dobius validates the returned binding and digest. `cloud-job-adam-transport.ts` captures and rechecks endpoint/auth epoch across token and HTTP awaits, and `adam-authorization-epoch.ts` generates an opaque process-local epoch. Do not claim this is a durable cross-process lease: after restart, a new epoch is expected, and recovery must perform fresh authenticated replay. The final synchronous local project/store/expiry checks must directly precede the atomic catalog write with no intervening await. ADAM's instance check remains server-side authority.

## Smallest safe first implementation slice

Implement only a **recovery-aware Dobius client/admission path for a caller that still possesses the original exact grant and approved input**:

1. Add a distinct `consumeBindingForRecovery` client method sharing strict identity/fingerprint/transport validation with normal consume, but allowing the server to replay an exact consumed response after expiry.
2. In one main-process service/admission flow, require the accepted exact response, call `findAdamBoundChild(input, response)` before any write, return the existing child on a match, and treat lookup mismatch/error as a hard refusal.
3. If and only if lookup returns `null`, verify the original expiry and current store/project/auth conditions, then submit the same normalized request key/input/binding synchronously through the existing atomic `submitAdamBound` path. Expired consumed-but-childless state requires explicit reapproval; expired unconsumed state is already refused by ADAM. Never mint a new grant or fall through from an unavailable/malformed response.
4. Add focused tests for consumed replay before/after expiry, expired unconsumed refusal, lost-ACK child recovery with unchanged event/outbox counts, null lookup before valid submit, mismatched lookup preventing submit, malformed response preventing lookup/write, and endpoint/auth epoch change.

This bounded slice is not autonomous restart recovery. Dobius currently does not persist the raw capability, and ADAM currently has no durable child-submit intent/worker; after process loss, a caller without the original grant cannot perform this recovery. Do not claim durable intent, protected capability sealing, or restart reconciliation until separately authorized ADAM intent ownership and an approved OS-backed sealer exist.

For the later ADAM slice, grant issuance and durable intent publication must be one SQLite transaction. Current `issueGrant()` owns its own transaction, so an outer transaction around it would be invalid/nested; refactor to a transaction-scoped issuance primitive or combined store operation. Publish the intent before handing off the grant, and do not dispatch if sealing or atomic publication fails. Keep child/binding/event/outbox creation atomic in Dobius; lookup is read-only and must not publish partial recovery state.

## Evidence and limits

Source evidence is limited to the exact local files and hashes below; no tests or runtime/provider operations were performed. The 13 receipt hashes were independently verified; the listed hash discrepancy is in the contract's additional inventory. This review establishes no implementation, packaged, or live acceptance.

| File | SHA-256 |
|---|---|
| `plans/worker-monitor-20261014/FIXER-adam-restart-reconciliation-contract.md` | `e6c2ab470297d0214fa87dbc40737fc6043896da917991e3da5f8745c4d295b3` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-client.ts` | `f3e8a8574dbc2ef3895085891d7604df3f6cd47c287e8287edde62f91bef1a8b` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-transport.ts` | `74d278505b3548788ac2cb599b2ce74ded1cd07b037daa28fdc6ef1f20b0c312` |
| `dobius/src/main/automations/cloud-job-submit-admission.ts` | `586d9edaa14a49095e39a80f32ddc7e71dbdc0d1e52ffa129829fa3ee13b6bb1` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-child-lookup.ts` | `a8cd25c3410b404781ab4f7bc417b2e0ce292c89150fdfcf41e28ceab1ae1480` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-outbox.ts` | `15c8c93691dc80bafe9b537dfa51189525f1ce68f846453b9b27f6f42ac78927` |
| `dobius/src/main/adam-authorization-epoch.ts` | `eb7d8e30a78976db99107bd43312572f81417af08d13a3921db3e61b909ab981` |
| `/Users/bayou/dobius/projects/ADAM/service/src/dobius-cloud/receipt-store.ts` | `7f49efb0be1e500873b196ccb12478f19aa22e8d1167e7a465811a2dce4cf9a1` |
| `/Users/bayou/dobius/projects/ADAM/service/src/runtime/service.ts` | `251b62dd624918e43c27cdaa37ca02a7e3d21c72162fe92ff681196826504862` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-drainer.ts` (contract-recorded) | `101df3f12471c90ef997a54b1cbfdd8af376498d49e3d4e1ed762c74fd9653f6df` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-drainer.ts` (actual) | `101df3f12471c90ef997a54b1cbfdd8af376498d49e8ef2f35b55f1f678fcd0b` |

Reviewed without tests, builds, Git mutation, credentials/private configuration, service/provider/RPC/device calls, or terminal actions.
