# RESEARCH independent review: ADAM capability sealer contract

Date: 2026-10-14  
Task: `task_8aa69395daf8`  
Dispatch: `ctx_edfbe107766b`  
Repository: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`  
Branch: `fix/channel-cost`  
Verdict: **PASS_SOURCE_CONTRACT** — the contract identifies the real source boundary and makes the main unresolved authorization gate explicit. This is not implementation or readiness acceptance.

## Freeze and hash verification

Reviewed `plans/worker-monitor-20261014/BUILD1-adam-capability-sealer-contract.md`, SHA-256 `ae40fe1558cc703883f4856c70492b62d9573f3cbb8642480ef993b78f9655ec` (13,096 bytes), against `plans/cloud-workstation-reports-20261012/build1.json:adam-capability-sealer-contract-20261014`. All 18 source/dependency hashes in the artifact were recomputed and matched current bytes. The build1 receipt also confirms no source edits, tests, secret-store calls, or live sealer claims.

## Source-backed findings

- **No current ADAM capability sealer or grant planner caller:** the inspected ADAM `DobiusCloudReceiptStore.issueGrant()` is a private synchronous store API that opens its own transaction, stores the capability hash, and returns the plaintext grant. A source search found no production caller in `service/src`; ADAM's existing `DobiusClient` wraps `execFile`-style CLI operations and has no stdin capability-sealing method. This supports the contract's distinction between an existing receipt store and a not-yet-existing durable child-intent producer.
- **No reusable Dobius sealer:** current `safeStorage` users are provider/token/identity-specific and some retain session-only or legacy plaintext behavior. The C05 lease sealer uses a local key file and a separate AAD namespace. Neither is a suitable ADAM capability facility.
- **Electron API shape is present, not a live availability proof:** installed Electron declarations expose `isAsyncEncryptionAvailable()`, `encryptStringAsync()`, `decryptStringAsync()`, and Linux `getSelectedStorageBackend()`. These APIs are main-process facilities; separate Node ADAM service code cannot call Electron main directly. No OS keychain or encryption API was invoked.
- **Linux backend is distinct from encryption availability:** `basic_text` and `unknown` must be refused even if an availability check alone returns true. Conversely, an OS-backed backend name is not enough if async encryption is unavailable or encryption/decryption throws. The contract correctly requires both checks and no plaintext fallback. `unknown` can also mean the app is not ready, so the implementation must establish readiness before selecting a backend.
- **Identity envelope and credential separation are well specified:** the envelope binds schema version, intent/binding IDs, ADAM instance, parent ID/version, project/context, request fingerprint and expiry. Since safeStorage has no caller-supplied AAD parameter, placing the identity inside the encrypted envelope and comparing every field after decrypt is the appropriate contract. The contract correctly forbids persisting bearer tokens, local service tokens, authorization epochs, plaintext capability, argv/log fallback, and reuse of the C02 key namespace.
- **Seal-before-transaction publication is implementable:** prepare the immutable grant/capability in memory; asynchronously seal before opening SQLite; then in one synchronous `BEGIN IMMEDIATE` transaction revalidate current instance, parent/revision/state, exact expiry/TTL and stable intent uniqueness, and insert the capability hash plus sealed intent. Commit before returning/handoff. A seal failure leaves no rows; a transaction/commit failure rolls both back. No await may occur while the writer transaction is open. Expiry must not be extended after sealing: if the prepared expiry has passed by transaction time, refuse both inserts and do not return the grant.
- **Crash and idempotency boundary is correctly surfaced:** a crash before transaction leaves no published grant/intent; a crash after commit but before handoff leaves a pending exact intent and binding. A retry with the same stable intent key must not mint or replace a grant. It may report/reconcile the existing intent, but returning its plaintext capability requires the separately authorized unseal path. Conflicting identity under the same key must refuse. The contract correctly identifies the stable planner idempotency key and production planner callsite as missing inputs/ownership rather than claiming they exist.
- **Process authentication remains a real blocker to unseal:** Dobius `authenticatedLocalSocket` is set after private runtime-token validation and excludes paired/IPC transports, but it proves a local socket client, not that the caller is the ADAM service process. The existing `adam.submitCloudChild` RPC fixes the planner principal for a bounded child submission; it is not an unseal API or a caller-process proof. Do not infer process identity from a local socket, caller-supplied principal string, executable name, or the current ADAM CLI wrapper. The contract explicitly keeps unseal unavailable until ROOT defines and reviews a concrete authorization boundary or accepts a documented same-OS-user threat model.

## Smallest safe next implementation packet

A deterministic source/test packet can proceed without exposing unseal or claiming production sealer availability:

1. **ADAM transaction slice:** in `service/src/dobius-cloud/receipt-store.ts`, refactor grant creation into a prepare/publish flow and add a new intent table/migration plus a transaction-scoped `issueGrantWithIntent` operation. Require an injected async `sealEnvelope` dependency; no default plaintext or local-key fallback and no production caller/wiring in this slice.
2. Generate a stable intent key and immutable canonical identity in memory. Call the injected sealer before opening the transaction. Inside one `BEGIN IMMEDIATE`, validate current ADAM instance, parent project/revision/state, fixed original expiry, and uniqueness; insert the capability hash and sealed envelope together. Commit before returning the original grant. On exact duplicate, return a non-secret existing-intent status without minting; conflicting duplicate refuses. Keep raw capability transient and never log it.
3. Use a deterministic fake sealer only in temporary SQLite tests to prove seal-before-lock, no publication on seal failure, rollback after either insert fails, expiry during sealing, exact duplicate/conflict behavior, reopen persistence, and no grant handoff before commit. Keep all intent recovery/unseal methods absent or unreachable in this packet.
4. Separately ROOT must design authenticated ADAM-to-main transport before adding unseal. Then add strict request/response bounds, caller authentication and lifecycle binding, identity comparison, and tests for unauthorized local callers, wrong identity, key/backend failure, and close/restart. A private local socket alone does not satisfy that gate.
5. Only after that transport is reviewed may an ADAM recovery worker unseal the exact pending grant, call the existing consume endpoint, and use Dobius exact-child lookup before any still-valid resubmission. This remains distinct from receipt delivery and from actual planner dispatch integration.

The typed Electron return `DecryptStringAsyncReturnValue` also carries `shouldReEncrypt`; the eventual adapter should honor its documented re-decrypt/re-encryption guidance or explicitly freeze a supported behavior. This is a small implementation detail to carry forward, not a reason to claim the OS backend is already available.

## Exact reviewed inventory

All listed hashes were independently recomputed and matched. ADAM paths are under `/Users/bayou/dobius/projects/ADAM`.

| Path | SHA-256 |
|---|---|
| `dobius/src/main/persistence.ts` | `f90f86d9b3adca86b18a7523a2fba7a7a25175b07625a5c1c8a2b67beb0cf488` |
| `dobius/src/main/communications/providers/provider-api-key-store.ts` | `153908be51dda7c7da11ccf721f2dc60703999b6f5089c830e4fa4201c50143e` |
| `dobius/src/main/asana/asana-token-store.ts` | `9af91c33f79ac1ad7444e58b4fb8ba3390798791c0995e9a9e8bcf9bc29876df` |
| `dobius/src/main/automations/workstation-worker/lease-sealer.ts` | `5e938fa52bd79aaa7d98d6bfd9812e3f191f8ed66069caa63c22776d6499a424` |
| `dobius/src/main/automations/workstation-worker/lease-sealer-key-file.ts` | `d3d82865666997ac67571eba4f33296bb99d4061d22935461ef6926ec790ea1f` |
| `dobius/src/main/automations/cloud-jobs/cloud-worker-bootstrap.ts` | `bbbeddb027a393cead54204e0affbbb19c0571afdc9dc34b8d84eb8efbad5aae` |
| `dobius/src/cli/handlers/adam-cloud-child.ts` | `5ce71e3623bc7a3d72a961fb73bfbaf503e60e1d43688c894a433384d4bfff11` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child.ts` | `c240dc87f192adf5ac4bfb114c86c3d5de82e5db65cf11c33b12c3d33866edbc` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-client.ts` | `7e5db6df8de5533d45bc45df7850cf346ea0c0a49bcf8515477473ff58018bce` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-transport.ts` | `74d278505b3548788ac2cb599b2ce74ded1cd07b037daa28fdc6ef1f20b0c312` |
| `dobius/src/main/adam-authorization-epoch.ts` | `eb7d8e30a78976db99107bd43312572f81417af08d13a3921db3e61b909ab981` |
| `dobius/node_modules/electron/electron.d.ts` | `09c70a8bd0d4a4c372b5529c4222d9059e3399e1b577c330acd8476ae520afb5` |
| `/Users/bayou/dobius/projects/ADAM/service/src/dobius-cloud/receipt-store.ts` | `7f49efb0be1e500873b196ccb12478f19aa22e8d1167e7a465811a2dce4cf9a1` |
| `/Users/bayou/dobius/projects/ADAM/service/src/dobius-cloud/receipt-contract.ts` | `7cdbfb8624e824311e29f71bb529d02aff2e0a04a76fc72621f11e3a43e45f51` |
| `/Users/bayou/dobius/projects/ADAM/service/src/db/database.ts` | `f72d88a8c29d59695b05a02d03b3e2d8e70a56346f9965e84bd7146dec319c91` |
| `/Users/bayou/dobius/projects/ADAM/service/src/db/migrations.ts` | `fc986082dae3175742421c5e3489370032e0c498b00d9de9a39b9adcd2c5954e` |
| `/Users/bayou/dobius/projects/ADAM/service/src/runtime/service.ts` | `251b62dd624918e43c27cdaa37ca02a7e3d21c72162fe92ff681196826504862` |
| `/Users/bayou/dobius/projects/ADAM/service/src/adapters/dobius.ts` | `6b5167cad2534c50a68490d07aaef272850a4f1087340b9af74f2c97a87a079b` |

No tests, builds, installs, Git mutations, credentials/profile/private data reads, service/provider/device actions, secret-store calls, AWS/Storage work, or head-agent actions were performed. No production unseal transport, durable grant intent, sealer wiring, packaged smoke, or live readiness is established.
