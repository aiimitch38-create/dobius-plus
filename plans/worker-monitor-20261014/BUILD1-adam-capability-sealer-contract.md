# ADAM durable capability sealer: source-only contract

**Task / dispatch:** `task_2b837e0fcff0` / `ctx_b671635a7a52`  
**Repository / branch:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, `fix/channel-cost`  
**Scope:** read-only preflight; no credential, profile, runtime, or platform secret-store access.

## Finding

No `DeviceSecretSealer`, secret-store client, or OS-keychain API exists in the inspected ADAM Node service source. Its `service/src/adapters/dobius.ts::DobiusClient` shells out with `execFile` for ordinary CLI commands; it has no capability sealing method and does not pass stdin. ADAM's `DobiusCloudReceiptStore.issueGrant()` is an internal store method with no current caller in the inspected service source. It creates a 32-byte capability, stores only its hash with the immutable binding identity, and commits its own synchronous `BEGIN IMMEDIATE` transaction. There is no durable child-submit intent table/worker today.

Dobius main owns Electron `safeStorage`, including Electron 42's `isAsyncEncryptionAvailable()`, `encryptStringAsync()` and `decryptStringAsync()` APIs. The Node ADAM service cannot import/use that Electron main API directly. Existing uses are provider/token-specific stores, not an ADAM capability interface. Some such stores intentionally retain values in session memory when encryption is unavailable; some legacy readers accept plaintext. They are not suitable as a durable capability API. C05's `workstation-worker/lease-sealer.ts` is an independent AES-256-GCM construction whose 256-bit key is a private file beside worker state; its AAD is `dobius/workstation-worker/lease-sealer:v1`. It is neither OS-backed nor an ADAM namespace and must not be reused for ADAM grants.

## Smallest implementable boundary

ROOT owns a new main-process-only ADAM intent sealer bridge. It wraps Electron `safeStorage` directly and is the only production code allowed to encrypt/decrypt the durable ADAM capability. It should have a typed internal boundary equivalent to:

```ts
type AdamIntentIdentity = {
  schemaVersion: 1
  intentId: string
  bindingId: string
  adamInstanceId: string
  parentObjectiveId: string
  parentObjectiveVersion: number
  projectId: string
  contextDigest: string
  requestFingerprint: string
  expiresAtMs: number
}

interface AdamCapabilitySealer {
  seal(input: { identity: AdamIntentIdentity; capability: string }): Promise<string>
  unseal(input: { identity: AdamIntentIdentity; sealedCapability: string }): Promise<string>
}
```

This is a contract shape, not an implemented API or availability claim. The bridge must check the app is ready and `safeStorage.isAsyncEncryptionAvailable()` before either operation. On Linux it must additionally reject `getSelectedStorageBackend()` values `basic_text` and `unknown`; only OS keyring backends such as libsecret/KWallet qualify. On macOS/Windows, require Electron's encryption availability and fail closed on thrown encryption/decryption. The platform backend must be independently verified as part of later packaged acceptance. There is no caller-supplied AAD parameter in `safeStorage`: serialize a versioned ADAM-only envelope containing the full identity plus capability, encrypt that envelope with `encryptStringAsync`, and after decrypt strictly compare every identity field before returning the capability. Do not describe this as caller-provided AEAD AAD.

The bridge is main-owned and unavailable to renderer/general RPC callers. It must receive bounded, validated requests over a private local transport and return only the sealed envelope for `seal`; `unseal` necessarily returns plaintext to the trusted ADAM service process for the existing consume call. The existing `authenticatedLocalSocket` flag proves a local socket transport, but current source does not establish a distinct ADAM service-process principal. ROOT must provide and review that caller authorization (or explicitly accept a documented same-OS-user boundary) before exposing unseal. Never trust a caller-supplied `principal` string as authentication. The existing `adam.submitCloudChild` method and its bounded stdin submission parser are not a sealing API and should remain dedicated to submission.

The service adapter must use bounded stdin/stdout pipes for the bridge, not argv, shell text, generic `execFile` arguments, command diagnostics, or log output. Keep the plaintext capability only in bounded memory and pipe buffers; sanitize failures to fixed messages. The encrypted envelope may be persisted in the ADAM intent table. Do not persist the ADAM HTTP bearer/service token, Dobius local service token, or any `adam-authorization-epoch` value in this intent. Do not reuse C02 lease key files or C02 auth/token namespaces.

## Atomic grant and intent publication

The current `issueGrant()` starts and commits its own synchronous transaction. Wrapping it in a second `BEGIN IMMEDIATE` would nest transactions; awaiting an OS bridge while a synchronous SQLite transaction is open would hold the writer lock across IPC and is not acceptable. The ADAM owner must replace the issuance callsite with a prepared, transaction-scoped operation:

1. The planner supplies a stable intent/idempotency identity and canonical approved request identity. Prepare a fresh binding ID and capability in memory, without publishing either. The exact immutable `AdamIntentIdentity` is then sealed through the main bridge **before** starting a DB transaction.
2. In one synchronous ADAM `BEGIN IMMEDIATE`, revalidate the current instance, parent project/revision/state, TTL, stable intent uniqueness and request fingerprint. Insert the binding row (including only the capability hash) and pending intent row (including only the sealed envelope and identity) in this same transaction. No `await` occurs while the transaction is open.
3. Commit both rows; only after commit may the original grant be handed to the planner/dispatch path. On sealing failure, backend unavailability, stale parent, duplicate conflicting intent, insertion error, or commit failure, publish neither row and do not hand off the grant. A retry with the same stable intent key must find/reconcile that exact intent rather than mint another grant.

The intended implementation surface is `service/src/dobius-cloud/receipt-store.ts` plus a new intent store/module and migration in ADAM `service/src/dobius-cloud/` and `service/src/db/migrations.ts`; refactor issuance into a transaction-scoped primitive or one combined `issueGrantWithIntent` operation. The planner/dispatch callsite is currently absent, so its owning module and stable source idempotency key are concrete missing inputs. Do not implement a standalone sealer and call that durable recovery: there must be a real producer that provides a stable intent identity and consumes it. The local recovery worker and lifecycle hook are also absent and need explicit ADAM ownership.

For recovery, read the pending intent, request `unseal` with the stored expected identity, then call the existing authenticated ADAM consume endpoint with the original exact capability/binding. `DobiusCloudReceiptStore.consume()` already returns the exact stored response for a previously consumed matching capability/identity before checking expiry; it refuses an unconsumed expired grant. Keep the existing bounded `cloud-job-adam-transport.ts` endpoint/auth epoch checks. After exact response, use the accepted Dobius `findAdamBoundChild` lookup-before-submit path; found child reconciles without another write, mismatch fails closed, and null permits only the same still-valid original approval. Do not mint replacement grants on ambiguous outcomes. C02 continuation/lease recovery stays in its existing namespace and is not changed here.

## Deterministic fixture plan

Use isolated temporary ADAM SQLite files and synthetic, non-secret capabilities with an injected deterministic bridge implementation; these prove transaction/order behavior, not OS-backed production readiness. Add focused cases for:

- seal is paused before transaction: binding and intent row counts remain zero; resolving seal then commits both; no grant escapes before commit;
- missing/unavailable sealer or thrown seal: no binding, intent, or dispatch; no plaintext fallback;
- failure after first insert and before commit: rollback leaves both rows absent;
- reopen and unseal under the same immutable identity returns the exact synthetic capability; wrong intent, binding, parent/version, instance, request fingerprint, expiry, envelope version or tampered ciphertext refuses without changing rows;
- retry with the same stable intent key after commit returns/reconciles the existing intent and never inserts a second grant; conflicting identity refuses;
- consumed exact grant replays and reconciles an already-committed child after expiry; expired unconsumed grant, missing child after expired consumed replay, unknown consume response, changed auth/endpoint epoch, or different ADAM instance never submits;
- logs/errors/stdout/argv snapshots contain no synthetic raw capability or bearer token; only the sealed envelope is persisted.

Add a separate gated packaged-main smoke for Electron safeStorage on each supported OS/backend, using synthetic fixture text only and an isolated test identity. Linux `basic_text`/`unknown`, `isAsyncEncryptionAvailable() === false`, encryption errors, and decrypt failures must be refusal cases. This preflight did not execute that smoke or call any secret-store API.

## Exact evidence and limits

The corrected FIXER recovery contract is `plans/worker-monitor-20261014/FIXER-adam-restart-reconciliation-contract.md` (`01164bbf13b6fac2a6ae94be4dbd3dd04b3325e1590a1f8a1975f6de2375ca61`), with its review receipt at `plans/cloud-workstation-reports-20261012/fixer.json:adam-restart-reconciliation-contract-20261014` (`PASS`). The independent source review is `plans/worker-monitor-20261014/RESEARCH-adam-recovery-contract-review.md` (`c99bd8c878b19b8cede5bd822c815ab891927c22965082c65c162462e37ce6ac`); its original `CHANGES_REQUIRED` was for the source inventory hash and wording, corrected in the current FIXER contract/receipt. The files below were read as source only; hashes are SHA-256 of exact bytes during this preflight.

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

No tests were run. No source/API wiring, credentials, private configuration/profile files, platform keychain calls, databases, service/provider/runtime/device actions, builds, installs, deployment, Git mutation, or live activation occurred. This contract does not assert an OS-backed sealer is currently wired or available, and does not claim durable ADAM recovery or production readiness.
