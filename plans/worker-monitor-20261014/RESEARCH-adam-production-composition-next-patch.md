# ADAM production composition: exact next patch plan

Date: 2026-10-15  
Task: `task_fc9093950b39`  
Dispatch: `ctx_9ce2f7f50a67`  
Coordinator: ROOT `term_d7866049-2f6c-4300-8625-8ddb23563089`  
Scope: read-only source composition plan; no tests, source edits, builds, or live activation.

## Decision

The next source patch should be one bounded, default-disabled, end-to-end composition slice across the Dobius main ingress and the ADAM durable-intent caller. Implement and test the Dobius service-principal ingress first within that patch because ADAM cannot safely seal an intent or submit a child until Dobius can authenticate the designated ADAM service. Complete the same patch with the ADAM publisher/recovery caller; do not accept an ingress-only helper as the completed composition.

Use a dedicated ADAM service-principal authorization lane on Dobius’s existing main runtime RPC transport, not the generic device registry, broad CLI dispatch HTTP server, or `authenticatedLocalSocket` flag. Keep the existing runtime RPC auth as transport/bootstrap protection, but require an independently verified ADAM principal before either crypto or a cloud-job write. This is a separate service identity and permission set, not a new head process. No current source provides the required process-bound transport proof or a live enrollment provider, so the new composition must remain unavailable by default and fail closed until the two follow-ups below.

The patch must create a real ADAM caller from an exact durable approved-decision record. It must not attach submission to `/v1/prepare-tomorrow`, which produces a read-only brief, or to `/v1/orchestration/jobs`, which compiles the existing worker-preflight/worker-launch workflow. The current `IMessageCommandGateway` approval row is a possible source of an approval record, but its current generic “Go” path selects the oldest pending item and the `/v1/approvals/*` routes accept a caller-provided `senderId: "carson"`; neither is sufficient proof of an exact, independently authenticated approval for a cloud child. The patch must add an exact approval ID, canonical payload digest, durable source/actor evidence, and a single-use/replay-safe transition before publishing.

## Actual source call graph and boundary

| Stage | Current source behavior | Production gap |
|---|---|---|
| Dobius startup | `dobius/src/main/index.ts` starts `startDobiusCli(runtimeService)` and later calls `createCloudJobAuthority(...)`; its `adamClientFactory` is gated by `authority.json.adamReceiptBridgeEnabled`. `createCloudJobAuthority` defaults that flag to false and opens its queue with dispatch disabled. | No principal registry, sealer, or unsealer is constructed or passed into `DobiusRuntimeRpcServer`; receipt-client enablement is not service-principal authorization. |
| Existing Dobius child ingress | `adam.submitCloudChild` is registered in `rpc/methods/index.ts`. The handler checks `authenticatedLocal` and `authenticatedLocalSocket`, then calls `submitAdamBound` using the literal `{kind:"local", id:"adam-parent-planner"}` and a request-supplied plaintext grant. | `runtime-rpc.ts` sets both local booleans on every request after the shared runtime token check. `UnixSocketTransport` uses a mode-0600 socket plus that shared token; its `net.Socket` handler exposes no peer PID/UID or verified ADAM identity. The booleans and planner string are not an ADAM identity. The method does not invoke the principal registry or unsealer. |
| Principal registry | `AdamServicePrincipalRegistry` validates strict identity/scope/generation, stores only a credential digest and issues unforgeable in-process proof objects. `unavailable()` refuses by default; `withTrustedAdapter()` accepts trusted bootstrap dependencies. | The registry is only referenced by its own tests; no main bootstrap or RPC caller uses it. It is memory-only, and no persistent enrollment, secure credential custody, OS peer verifier, or trusted revocation source is wired. An injected/test adapter is not production peer proof. |
| ADAM startup and routes | `service/src/main.ts` constructs one `AdamService`; `AdamService.start()` hosts the authenticated loopback HTTP service. Its bearer token guards `/v1/dobius/cloud-job-bindings/consume` and `/v1/dobius/cloud-job-receipts`. | The token authenticates possession of the ADAM API token, not the process to Dobius; current code does not call Dobius seal/unseal or child ingress. Do not reuse a request-body principal claim or generic runtime token as service identity. |
| ADAM “planner” candidates | `AdamSupervisor.prepareTomorrow()` accepts a command and builds a read-only executive brief. `AuthoritativeOrchestrationSupervisor.compile()` creates the existing preflight/worker-launch workflow. `evaluateAction()` is exported but has no production callsite. | None creates an `ApprovedJobIntentRequest`, calls `issueApprovedJobGrantWithIntent`, or submits a cloud child. These are not valid production publication callsites without a new, persisted authorized decision step. |
| ADAM intent publication | Applied V2 `DobiusCloudReceiptStore.issueApprovedJobGrantWithIntent()` calls `intent-publication.ts`, which validates/canonicalizes the payload, asks a sealer for ciphertext, then transactionally rechecks instance, parent revision/project and expiry before inserting binding+intent+payload. | The wrapper has no non-test caller. Its returned `grant` must not be forwarded as a plaintext CLI capability; the submitted material must be read back from the durable sealed intent record. |
| ADAM child submit | `submitAdamCloudChild()` normalizes/fingerprints input, asks an injected `authority.acquire()`/`isCurrent()` dependency, then invokes `dobius submit-adam-child --request-stdin --json`. | There is no production callsite or authority provider. The current request contains a plaintext grant and proof acquisition is an injected contract, not service enrollment. Adapt the production request to carry the durable intent ID/identity/sealed envelope and approved payload, never the raw capability. |
| Dobius admission and Kanban | `CloudJobService.submitAdamBound()` calls `admitCloudJobSubmission()`. That code consumes the binding, rechecks project/store identity, looks up the exact prior bound child on recovery, and otherwise calls the same `CloudJobStore.submitAdamBound()` used by the job board. | Recovery mode currently derives from the hard-coded local planner string. Replace this with the unforgeable verified service-principal proof; preserve the exact same-store transaction and no-await final authorization fence. |
| Seal/unseal | Main-only safeStorage factories strictly validate identity/purpose and invalidate on runtime changes; the unsealer returns the original grant from a sealed envelope. | Both factories are definition-only outside tests; no production caller is wired. The current installed Electron is reported as 42.3.3, below the source minimum 42.4.1, so this path must fail closed in the current packaged runtime. |

## Patch 1: production-used source composition, default OFF

### Dobius owner: main service-principal ingress into the existing queue

Modify these production paths together:

- `dobius/src/main/index.ts`: construct one main-owned `AdamServicePrincipalRegistry`/bridge host before `DobiusRuntimeRpcServer` creation; default it to unavailable. Wire its verifier and the main-only sealer/unsealer through the runtime RPC construction. Do not create crypto authority from a renderer/CLI request or from `adamReceiptBridgeEnabled` alone.
- `dobius/src/main/runtime/runtime-rpc.ts`, `dobius/src/main/runtime/rpc/unix-socket-transport.ts`, `dobius/src/main/runtime/rpc/dispatcher.ts`, and `dobius/src/main/runtime/rpc/core.ts`: carry a transport-produced, non-serializable peer evidence object into only the ADAM method. Do not infer ADAM identity from the shared auth token, socket pathname/permissions, PID supplied in JSON, process path/hash alone, or the existing local booleans. The current Node socket implementation has no such evidence source; the registry must remain unavailable until a reviewed platform transport provider can produce it.
- `dobius/src/main/runtime/rpc/methods/adam-cloud-child.ts`: replace the current “local socket + literal planner ID + plaintext grant” contract with strict `adam.sealApprovedIntent` and `adam.submitApprovedIntent` operations. Both require registry `verify` then `authorize` against the exact request and audience before safeStorage or queue effects. Seal accepts the transient ADAM capability envelope and returns only the sealed envelope. Submit accepts the persisted intent identity, canonical approved payload, and sealed envelope; it unseals internally, verifies all identity/project/fingerprint bindings, then submits through the existing queue service. Recheck principal generation and current project/queue authority after every await and immediately adjacent to the transaction; revoke while awaiting means no child write.
- `dobius/src/main/adam-service-principal/principal-contract.ts` and `registry.ts`: use the already-reviewed strict service/instance/audience/generation/method/project/resource contract, but make production trust originate only from the main-owned transport/enrollment host. Persisted enrollment/revocation state and its protected verifier are still absent and must be explicitly implemented or kept unavailable. Preserve memory-only test adapters as tests only.
- `dobius/src/main/automations/cloud-job-authority.ts`, `cloud-job-service.ts`, and `cloud-job-submit-admission.ts`: wire proof-checked submit/recovery to the existing `CloudJobStore` and `CloudJobAdamClient`; do not derive recovery from a caller string. Keep `adamReceiptBridgeEnabled` separate from new service-principal ingress readiness and leave both default-off. Do not duplicate the jobs database or create a second Kanban path.

### ADAM owner: one exact durable-decision publisher and recovery caller

Modify these production paths together with the ingress; no new head, gateway, scheduler, or database:

- `service/src/imessage/gateway.ts` and its schema/migration/tests: make the cloud-child decision an exact typed approval record, not arbitrary approved JSON. Bind approval ID, trusted human/source actor evidence, parent job ID+revision, project, canonical complete child payload/digest, stable `intentId`, and expiry. Approval must target that ID and digest; reject ambiguous “approve oldest pending” for this action. Current `senderId` request fields are not actor evidence.
- `service/src/runtime/service.ts`: add one narrow internal dispatch method/route that takes only the durable decision ID, loads the approved record from the same `AdamService.db`, and calls the production publisher. It must not take `approvedJob`, actor, project grant, or decision text as authoritative request fields. Do not overload `/v1/prepare-tomorrow`, `/v1/converse`, or generic `/v1/orchestration/jobs`.
- `service/src/dobius-cloud/receipt-store.ts`: call the already-applied `issueApprovedJobGrantWithIntent()` with a production sealer client to `adam.sealApprovedIntent`; retain the existing V2 canonical payload validation and seal-before-transaction/recheck/atomic publication. Add a read-only durable submission DTO lookup returning the exact sealed envelope + identity + approved payload for one stored intent; never return the capability from this recovery lookup.
- `service/src/supervisor/supervisor.ts` (the current `AdamSupervisor` owner) or a tightly scoped caller module owned by that supervisor: after the exact durable approval is verified, publish once and call the existing `submitAdamCloudChild()` adapter using the persisted sealed DTO. Add a bounded single-flight/lease or CAS on this one intent so overlapping tick/startup attempts cannot mint alternate intent IDs. The caller must not treat the publisher’s transient return grant as the durable retry input.
- `service/src/runtime/service.ts` `start()`/existing supervisor recovery cadence: before submission readiness, scan only eligible persisted cloud-intent rows and retry the same intent ID and request key. A timeout/lost response remains ambiguous and retries the same durable record; never create a new capability or intent. The ADAM parent stays unchanged; receipts remain observations. Persist/ack the exact returned child ID so the ADAM job projection and Dobius Kanban refer to the same child.
- `service/src/dobius-cloud/child-submit.ts` and `child-submit-contract.ts`: change production wire input to sealed intent material (no raw capability), pass only bounded stdin to the existing Dobius CLI command, bind the response to the same intent/request/runtime, sanitize remote selectors as today, and keep errors/logs capability-free. Any legacy plaintext request must be refused by the production command.

### Wire contract and identity rules

Main-only request authentication is separate from payload claims. The trusted transport supplies `peerEvidence`; the client supplies no peer PID, service role, or trusted generation. The main-owned registry derives the registered identity and verifies the presented per-instance credential before method authorization. Each request binds:

- `serviceId = adam` and ADAM database `instanceId`;
- exact target `audienceRuntimeId` from the current Dobius runtime;
- monotonic `authorizationGeneration`, revoked on any credential/permission/project change;
- `method` limited to `adam.sealApprovedIntent` or `adam.submitApprovedIntent`;
- an enrolled `projectId` and exact `resourceId = intentId`/`bindingId`;
- canonical intent ID, parent ID/revision, context digest, request fingerprint, expiry, and approved payload digest.

ADAM holds its service credential only in its appropriate OS-protected custody; Dobius persists only the verifier/digest and a minimal identity/scope record. Enrollment is a user-authorized main-process action with explicit project and method scopes. The ADAM service bearer, Dobius runtime bearer, paired-device tokens, `serviceId` strings, and test adapter callbacks are not substitutes. Revocation must invalidate in-flight proofs before the final store transaction. For a remote ADAM host, use an independently authenticated remote transport and the same audience/instance/project/generation constraints; do not route remote requests through local CLI selection or grant the laptop’s shared runtime token.

The exact sealed-intent DTO is `{schemaVersion, intentId, identity, sealedEnvelope, approvedJob}`. It contains no capability. The seal request temporarily carries the strict `AdamCloudIntentEnvelope` because ADAM generates the capability; it returns ciphertext and is never logged. Dobius verifies `approvedJob.projectId === identity.projectId`, canonical payload digest equals `requestFingerprint`, instance/audience/scope match, and intent identity is unchanged before/after asynchronous crypto.

## Acceptance for Patch 1

Use synthetic identity providers and temporary databases only; tests prove source composition, not OS identity or live enrollment.

1. No trusted transport evidence/enrollment, wrong instance/audience/project/method/resource, stale generation, replayed/revoked credential, or malformed identity is refused **before** `safeStorage` and before all DB writes.
2. Revocation/project change while seal, unseal, or ADAM consume awaits prevents the next effect and the final child write.
3. Seal call returns only ciphertext; ADAM commits sealed intent+immutable approved payload+binding atomically; crash before commit leaves no binding/intent, and retry with the same durable intent does not reseal or renew expiry.
4. ADAM restart from a temporary DB re-reads the exact intent and approved payload; lost child ACK retries same identity/request key and returns the same bound child ID, with one Kanban row and no parent transition.
5. Expired but previously consumed intent replays the exact stored consume response and finds/returns the same child; expired and unconsumed intent refuses with no new child/capability.
6. Concurrent duplicate publication/submission uses the same intent ID, binding, and request key; one binding and at most one child. Stale/mismatched receipt or runtime response never falls through to fresh submission.
7. Legacy generic local RPC, local CLI, paired/mobile/runtime device token, malformed service, or request-supplied planner string cannot call either new method. Existing non-ADAM RPC/terminal behavior remains unchanged.

## Two immediate followups (and no implicit activation)

1. **OS-backed service enrollment and transport proof.** Implement and review actual local peer/process proof plus protected ADAM credential custody for supported OSes and durable main-owned enrollment/revocation/generation persistence. The current Unix/named-pipe transport does not expose enough process identity; a same-user bearer, file owner/mode, binary path/hash, or callback is not acceptance. Unsupported platform/remote transport must refuse. Add platform-specific tests and a synthetic end-to-end test; do not enable the production bridge until this proof passes.
2. **Operator and packaged/live gate.** After reviewed enrollment exists, install/package only under a separately authorized build window and supported Electron >=42.4.1; explicitly enroll the existing ADAM instance and projects, confirm exactly one existing Hermes Adam decision owner (Friday remains helper), then run a controlled authorized child→same Kanban→receipt/restart/revoke sequence. Build 20 receipt currently says `live_dispatch_ready=false` and `adam_bridge_enabled=false`; this plan does not change either flag or claim the current runtime is ready.

## Source evidence and limits

The ADAM V2 approved-payload receipt records six actual ADAM files applied, source-only, with 38 focused tests and strict NodeNext typecheck passing; it explicitly records no ADAM restart, database migration, or bridge enablement. `root-local-delivery.json#desktop_build20_delivery` records installed build 20, but both `live_dispatch_ready` and `adam_bridge_enabled` are false and the receipt says real Hermes/ADAM endpoints are not activated. The current source test receipts establish bounded components only. No live endpoint, credential, private config, DB, account, agent session, or keychain was inspected here; no tests were run for this plan.

This patch does not start a competing Hermes process, migrate the existing Adam/Friday sessions, modify the ADAM parent from a child receipt, or imply remote transport is implemented. ADAM remains the independent control/runtime; Dobius remains the executor and UI.

## Exact inspected artifact/source SHA-256

Hashes below are the bytes read for this plan; local paths are relative to the Dobius repository. ADAM source is in the canonical read-only checkout `/Users/bayou/dobius/projects/ADAM/service`.

| Path | SHA-256 |
|---|---|
| `plans/worker-monitor-20261014/ROOT-adam-dobius-hermes-bridge-research.md` | `531fb97079cfba1dd4aa67fb43f68132756d5f6b0477fcedbfa25d24317d100e` |
| `plans/worker-monitor-20261014/ROOT-adam-dobius-hermes-bridge-research.json` | `2aca6e13b8231b4883c3bd697707d2a0429614bb3da52b27b3f61c3050958a5d` |
| `plans/worker-monitor-20261014/ROOT-adam-approved-payload-application.json` | `9ca8831d1f65ecd141bd898a8f9dff44e48bbc3755d19c0ec14dcad9221aa868` |
| `plans/cloud-workstation-reports-20261012/root-local-delivery.json` | `16306aa1b04ec0c115fbca8d3738879e5c103fed35acbe2885602c9365171617` |
| `dobius/src/main/adam-service-principal/principal-contract.ts` | `02e49314b603e60a5dcd44a27ac1481e832180fd42bece867afd76f8875995c5` |
| `dobius/src/main/adam-service-principal/registry.ts` | `5ed3004c6cb5604e7d4a2c3a6a3f4c384d75603e47f7d4bf4fee91dcb02d765f` |
| `dobius/src/main/index.ts` | `d91ac3cb77b4caf807e25ac8e6b23f13d9cf563038fa8e932cb0e07de48ce97c` |
| `dobius/src/main/runtime/runtime-rpc.ts` | `c524709d25b8a7676b42882314f4683a313ecc6b7167d7ffd40e33cb050c3173` |
| `dobius/src/main/runtime/rpc/unix-socket-transport.ts` | `f7d9a1fcb4a45822dae63763071d4c6dc95a063aaddfa07f2b50741479eb3da1` |
| `dobius/src/main/runtime/rpc/dispatcher.ts` | `14d8d3c8f294739e297172eda052ee459dbc7d3afd7c67468c855c38d28f00ae` |
| `dobius/src/main/runtime/rpc/core.ts` | `09573d96d4b989aa2702ce3c47d742b7e9b08eb643484e2665cf8c960f3ea51d` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child.ts` | `c240dc87f192adf5ac4bfb114c86c3d5de82e5db65cf11c33b12c3d33866edbc` |
| `dobius/src/main/runtime/device-registry.ts` | `942b6a15ac64610c93f5d86bbf109ad52dac52d9b7915fa5090a2b2ed7bc9fdb` |
| `dobius/src/main/dobius-cli/dispatch-server.ts` | `e1f96571401ab9290b244cf17dc0ccd7945bc03b6f2e359918711ad8fbb4d886` |
| `dobius/src/main/automations/cloud-job-authority.ts` | `68c2b71503572c895482718fe5c3aacf386e6e63d645c9f433102704db599ed7` |
| `dobius/src/main/automations/cloud-job-service.ts` | `d44d5e3da5a04671e4d53e1e3ac0ed30f03dd788b624e5dd1440e785c6f41e4d` |
| `dobius/src/main/automations/cloud-job-submit-admission.ts` | `96dcfcc0b7079204dcd8f4bca5c4628bc7c20a22111a444b731138be566f8004` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-client.ts` | `7e5db6df8de5533d45bc45df7850cf346ea0c0a49bcf8515477473ff58018bce` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-transport.ts` | `74d278505b3548788ac2cb599b2ce74ded1cd07b037daa28fdc6ef1f20b0c312` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-child-lookup.ts` | `a8cd25c3410b404781ab4f7bc417b2e0ce292c89150fdfcf41e28ceab1ae1480` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-intent-protocol.ts` | `fa37570e1c11df1ac4e8e4123b05e5fef5969edad4a3fe9626a139e5cc3b8737` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-intent-runtime.ts` | `156e1c67f85d6e5418195836a566277ccfb7d8ec4db27357a310ad1effb8307f` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-intent-sealer.ts` | `734716077ca29d59102d108d69d7ae9aade36d48a50b8c9e8dabd2f5e0bd63fb` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-intent-unsealer.ts` | `b9e07897fedf00e0983215dc5e9d9aaaedc8167f41cc04f7dfca6c55dff50a11` |
| `/Users/bayou/dobius/projects/ADAM/service/src/main.ts` | `58159e34ecb3948a2ce809429b92a7da8a484d5683f27eae2bd556ce8bcad066` |
| `/Users/bayou/dobius/projects/ADAM/service/src/runtime/service.ts` | `251b62dd624918e43c27cdaa37ca02a7e3d21c72162fe92ff681196826504862` |
| `/Users/bayou/dobius/projects/ADAM/service/src/supervisor/planner.ts` | `38d10d05502df48fc9f0dc3bbcbb1414e9c867832f25c28a46b02eab162fd9f7` |
| `/Users/bayou/dobius/projects/ADAM/service/src/supervisor/supervisor.ts` | `233f078a47569e1ef1d3495a9b2234863371320a6c6eca1b517b92e19072e84a` |
| `/Users/bayou/dobius/projects/ADAM/service/src/orchestration/supervisor.ts` | `7fdf98cc1be184f3fd2701f0281524f1397866e491a4c8cb6fed6be61a2ff0cf` |
| `/Users/bayou/dobius/projects/ADAM/service/src/policy/evaluate.ts` | `29a6a4c045fd58e6cd9386b9ac43c80de604a49d0dd81b9326f63afed4160374` |
| `/Users/bayou/dobius/projects/ADAM/service/src/policy/action-digest.ts` | `b1c3309580e73e8967d241972f23e5698bb78bce71b913319815ef682fc39a65` |
| `/Users/bayou/dobius/projects/ADAM/service/src/dobius-cloud/intent-contract.ts` | `60d148b77864bb83025e1d8cfeb6f0b3883d3d995759df306fbce165880a7ecd` |
| `/Users/bayou/dobius/projects/ADAM/service/src/dobius-cloud/approved-job-payload.ts` | `7b478d364798bb28f2dc5d052ca8e06a60f6b1db28de7913146af4a14c7560a5` |
| `/Users/bayou/dobius/projects/ADAM/service/src/dobius-cloud/intent-publication.ts` | `8248ffc77766abb62c50303bf51fd5a917652899b480a6b714399ff4a0c25544` |
| `/Users/bayou/dobius/projects/ADAM/service/src/dobius-cloud/receipt-store.ts` | `f53ffe295a5b27d01934489cef907cca59e9e4a159019bdfcc932a65a5ed5e2a` |
| `/Users/bayou/dobius/projects/ADAM/service/src/dobius-cloud/child-submit.ts` | `c1a5408fba3d5dbed7e7187f0764631586f4afd8301dbe260b22d1adfdf57546` |
| `/Users/bayou/dobius/projects/ADAM/service/src/dobius-cloud/child-submit-contract.ts` | `00200dfefdfa30fb9a5264cdb3b04fe3dd818f3061fb14c0f00ac2731287e066` |
| `/Users/bayou/dobius/projects/ADAM/service/src/adapters/dobius.ts` | `6b5167cad2534c50a68490d07aaef272850a4f1087340b9af74f2c97a87a079b` |
| `/Users/bayou/dobius/projects/ADAM/service/src/jobs/store.ts` | `e155bdf80a037a1de17364e0a9865941932b19a9f02717d0864f8084a80feb46` |
| `/Users/bayou/dobius/projects/ADAM/service/src/events/ingest.ts` | `46f01b58ae4ee0cbd9a4d8c3e40890ae11c270498d2c0f72fd4cc671c1df3207` |
| `/Users/bayou/dobius/projects/ADAM/service/src/imessage/gateway.ts` | `e59f8bb96bb26408d804776964d396915029b6dedf16e11dc9e5b44d0e719c71` |
