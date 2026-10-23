# BUILD1 ADAM main production-composition source packet

Task `task_2de8559c7700`; dispatch `ctx_d6e4045cd6d3`. Canonical repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`.

## Result and production boundary

Implemented the Dobius main-process ingress and admission lane for the approved ADAM intent wire. The immutable ROOT wire contract is `plans/worker-monitor-20261014/ROOT-adam-approved-intent-wire-v1.json` (SHA-256 `f31b56bec89ac9841afed587eea76e6f5ba085c800f0a26e7760ba60a7e26e6f`); the research patch plan is `plans/worker-monitor-20261014/RESEARCH-adam-production-composition-next-patch.md` (SHA-256 `1b873fa76eff7aa646d0841ab4d3ed3d6a965f2236819df724b0b38f32012db0`). RPC names, DTO fields, CLI command names, and the 131072-byte stdin cap match that contract.

`src/main/index.ts` constructs a main-owned bridge host with lazy Electron safeStorage seal/unseal adapters and `AdamServicePrincipalRegistry.unavailable()`. `DobiusRuntimeRpcServer` passes the bridge to the dispatcher, while RPC peer evidence can enter only through the transport-owned message context; request parameters cannot populate it. The current Unix transport sets no ADAM peer evidence, and production startup configures no trusted enrollment/peer adapter, so the production path remains disabled and refuses before crypto, binding consumption, or job-store effects. Runtime stop disposes the bridge and its crypto lifecycle.

The new `adam.sealApprovedIntent` and `adam.submitApprovedIntent` handlers use the strict shared wire schemas. The bridge verifies service `adam`, the exact ADAM instance/runtime audience, method, project, resource intent and current authorization generation; it reauthorizes after awaited seal, unseal, and consume operations. Submit checks the full immutable identity and canonical approved-job fingerprint before using the existing `CloudJobService`/`CloudJobStore`. Admission recovery now takes an explicit verified-main authorization callback; the literal caller string `adam-parent-planner` cannot independently activate recovery. Expired consumed grants can only resolve the exact existing child, while expired unconsumed grants or missing exact children cannot create a fresh row. Legacy `adam.submitCloudChild` and plaintext-grant CLI packets refuse.

The `seal-adam-intent` and `submit-adam-child` CLI commands accept only bounded JSON from stdin, suppress remote selection, and expose no credential/capability through argv or errors. A new dispatcher-level regression proves that a peer-shaped request-body field plus a shared local bearer does not authenticate; only synthetic transport-context evidence reaches the enrolled test registry. A production-default factory regression proves refusal before any lazy Electron crypto call. The test peers, credentials, capabilities and ciphertexts are synthetic only.

## Exact owned source/test freeze

| Path | SHA-256 |
|---|---|
| `dobius/src/main/adam-service-principal/adam-cloud-intent-bridge.ts` | `c02ceca8b815a35bfb23c2b7354d4fbb8e7fcd3ba208861a5a15d70c35d3f503` |
| `dobius/src/main/adam-service-principal/create-default-adam-cloud-intent-bridge.ts` | `818f230fd16b0a3a012b77f045f0acd59ac18afebcd5b2370b2045e2791da4c4` |
| `dobius/src/main/adam-service-principal/create-default-adam-cloud-intent-bridge.test.ts` | `9f40c342b5fbb0bbf992dc9b61b03c7b0600a326de3040de9abe17e9f4b59472` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child-test-fixtures.ts` | `d12422edf4a21f278a83f5bf610638101915b396b8c4edca8ceb86cb1404b984` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child.test.ts` | `04c1a85031cea48a2ee44e89c6c2e657b7eb89dce5084b017d1671608fa239cb` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child-dispatch.test.ts` | `308616fd7c2a58fde399105b1bfd75fd4f942d960cc1502142c244827856a2a4` |
| `dobius/src/shared/cloud-job-adam-intent-wire.ts` | `b410766c440d396befc46d56121cc646fb2eecdc4c33104f06104750d11c3898` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-intent-protocol.ts` | `71a12595a9036a8f324d9bf8db4693eab5a19bf8cc066c3f21068e4eb6a4693e` |
| `dobius/src/main/automations/cloud-job-submit-admission.ts` | `7a9b8b6565a8a518211bcc9a1ff948f907e73fe7a80dda75da52a539b5ea513c` |
| `dobius/src/main/automations/cloud-job-service.ts` | `87a838c3c54a292240a8fee88a6f7e407187ea430ed2fd4c5bb2659a56509ddc` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-child-lookup.ts` | `945c35ee326d076073f99c661d0cd276ac5938bb11e83e3f1e45a16f5136d59f` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-catalog.ts` | `2334a34739a0e396f2c858d3dc5725a5f3af761d51cb44738177f1e847dec7ed` |
| `dobius/src/main/runtime/rpc/core.ts` | `9dbb45ba777c8cb8c46221fc2be6095ee544cf5df81b2f67bb0898cffd07dfd0` |
| `dobius/src/main/runtime/rpc/dispatcher.ts` | `9415ba071c16adb92587f6dddc55511e110042ad12a68d22777b6ec4fcccb6c2` |
| `dobius/src/main/runtime/rpc/transport.ts` | `faf82b069dbf2d3d86264e7e564635eeb841d86bead5846e5e82a02a777066d4` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child.ts` | `cfdc8c2f4b610b973a6af6a33c30cdec9d21bb52037dbac1abc29de7535b4db3` |
| `dobius/src/main/runtime/runtime-rpc.ts` | `1dd60c75f5f65cae76fc2d3998037aec0c9251d9416d29b2c0426b7d472c2928` |
| `dobius/src/main/index.ts` | `fe8ab4b096ab7d5c8b17dd65aec5dd89193f0fb04d817a7838ee44e85362fa34` |
| `dobius/src/cli/handlers/adam-cloud-child.ts` | `0606402078843e5a0cce56d30a4dd79268ecf6d0357b71aa8431d8b9e8fb38f5` |
| `dobius/src/cli/handlers/adam-cloud-child.test.ts` | `11e85c2fd84cf8ffdda2bd392683dfe313bb56b5154906e88cb848dfe9dbaa9c` |
| `dobius/src/cli/specs/adam-cloud-child.ts` | `4e7f75b1cb90f67a1b50256e6b21482d87c3920a210a662a5d0507c089be15aa` |
| `dobius/src/cli/index.ts` | `4c60a4e1bb226d9a463e7e295b945b0273378f00b309a1d7c487bc421a8cf79f` |
| `dobius/src/main/automations/cloud-job-submit-admission-recovery.test.ts` | `d3d024a1bcca7d746795f9570734318f37d1fbf35f6e823aa35fe2ed7807cc3c` |

## Verification

Final focused Node 24 command (`v24.18.0`, Vitest `--maxWorkers=1`) passed: **12 files, 129 tests**.

```text
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/main/adam-service-principal/registry.test.ts src/main/adam-service-principal/create-default-adam-cloud-intent-bridge.test.ts src/main/automations/cloud-jobs/cloud-job-adam-intent-sealer.test.ts src/main/automations/cloud-jobs/cloud-job-adam-intent-unsealer.test.ts src/main/runtime/rpc/methods/adam-cloud-child.test.ts src/main/runtime/rpc/methods/adam-cloud-child-dispatch.test.ts src/cli/handlers/adam-cloud-child.test.ts src/main/automations/cloud-job-submit-admission-recovery.test.ts src/main/automations/cloud-jobs/cloud-job-adam-child-lookup.test.ts src/main/automations/cloud-jobs/cloud-job-adam-atomic-events.test.ts src/main/automations/cloud-job-service.test.ts src/main/runtime/runtime-rpc-cloud-jobs.test.ts --maxWorkers=1
```

Both strict Node 24 typechecks passed (exit 0):

```text
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit --composite false --incremental false -p config/tsconfig.node.json
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit --composite false --incremental false -p config/tsconfig.tc.cli.json
```

Scoped `oxlint`, `oxfmt --check` across the 23 owned source/test files, and `git diff --check` passed. One initial lint/typecheck run caught an unused import in the new factory test; it was removed before the final suite/typecheck. No build, install, dependency change, Git mutation, service restart, or live request was performed.

## Remaining gates and limitations

This is source-level Dobius composition, not installed/live acceptance or cross-repository end-to-end approval publication. No privileged process-peer provider, enrollment route, persistent protected service credential, or revocation source is wired. Normal startup deliberately supplies an unavailable registry and the current Unix socket transport supplies no ADAM peer proof, so the production methods remain unavailable. The installed Electron version was previously reported as 42.3.3, below the reviewed safeStorage minimum 42.4.1; no platform probe was performed, and the crypto adapter refuses older versions. BUILD2's ADAM publisher/recovery implementation and independent review, trusted enrollment/transport integration, safeStorage-capable package upgrade, and packaged acceptance remain outstanding. AWS stays deferred and historical Storage remains paused.
