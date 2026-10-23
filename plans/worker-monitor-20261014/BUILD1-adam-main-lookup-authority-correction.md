# BUILD1 ADAM main lookup authority correction

Task `task_130a3353c219`; current dispatch `ctx_353db44c56fe`; coordinator `term_02e778a4-11ae-4292-ba0f-49e2473a2ad9`; runtime `f3546568-4e43-479f-bdf2-f53faba443f1`.

Canonical repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`. This corrected packet supersedes the prior 24-file lookup/recovery packet, whose independent review returned CHANGES_REQUIRED; no BUILD2 candidate files were changed.

## Result

Closed both review findings while preserving the fixed base and additive recovery wire contracts. Stable `intentId` remains an independent UUID from `identity.bindingId`; lookup carries the requested intent unchanged into authorization and unsealing, and the unsealer result must match that exact intent plus the complete immutable binding identity.

Before awaiting unseal, the bridge captures the exact CloudJobService and a reader bound to its store object, service generation/liveness, project document, and monotonic project-authority revision. The same independent service proof/lifecycle and store/project fences are checked after unseal, immediately before the synchronous read, after the read, and before response; project revision fencing rejects update-then-restore (ABA) mutations as well as changed project snapshots.

## Regression evidence

- Failing-first distinct-ID regression: temporarily reinstating the old lookup `intentId === bindingId` restriction made `seals, submits, and recovers with distinct stable intent and binding UUIDs` fail at lookup with the fixed refusal; removing the unsupported equality made the integrated temporary-SQLite seal/submit/lookup path pass. The test also checks wrong-intent refusal, exact recovered child, no extra unseal on wrong intent, no consume or submit calls during lookup, and unchanged SQLite table snapshots.
- Failing-first authority ABA regression: with snapshot-only project fencing, a temporary SQLite project update from recipe-1 to recipe-2 and back to recipe-1 during deferred unseal incorrectly returned the child; capturing the monotonic catalog project revision made it refuse. Store replacement during deferred unseal and service replacement also refuse with fixed errors and no lookup writes/consume/submit effects.
- Existing tests retain pending proof/unseal revocation and disposal coverage, exact absent-child/expired-child read behavior, separate lookup enrollment, and dispatcher peer-evidence boundaries.

## Verification

Node `v24.18.0`. Final focused Vitest command passed **13 files / 144 tests**, maxWorkers=1:

```sh
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/main/adam-service-principal/registry.test.ts src/main/adam-service-principal/create-default-adam-cloud-intent-bridge.test.ts src/main/automations/cloud-jobs/cloud-job-adam-intent-sealer.test.ts src/main/automations/cloud-jobs/cloud-job-adam-intent-unsealer.test.ts src/main/runtime/rpc/methods/adam-cloud-child.test.ts src/main/runtime/rpc/methods/adam-cloud-child-dispatch.test.ts src/main/runtime/rpc/methods/adam-cloud-child-lookup.test.ts src/cli/handlers/adam-cloud-child.test.ts src/main/automations/cloud-job-submit-admission-recovery.test.ts src/main/automations/cloud-jobs/cloud-job-adam-child-lookup.test.ts src/main/automations/cloud-jobs/cloud-job-adam-atomic-events.test.ts src/main/automations/cloud-job-service.test.ts src/main/runtime/runtime-rpc-cloud-jobs.test.ts --maxWorkers=1
```

Both strict checks passed (exit 0):

```sh
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit --composite false --incremental false -p config/tsconfig.node.json
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit --composite false --incremental false -p config/tsconfig.tc.cli.json
```

Scoped `oxlint`, `oxfmt --check`, and `git diff --check` passed (exit 0). The service contract type extraction keeps the service module within the repository max-lines rule without disabling lint.

## Frozen source paths and SHA-256

26 exact source/test paths; aggregate is SHA-256 over compact JSON of the sorted path-to-hash map: `161e35a3e607c3016af1fb08dfd18015cd9d5b823436eacf58543128e9ed983c`.

| Path | SHA-256 |
|---|---|
| `dobius/src/main/adam-service-principal/adam-cloud-intent-bridge.ts` | `63224e4db0ab881cc6afe9f53bc855619294438659280b793c5d17d17bf288c9` |
| `dobius/src/main/adam-service-principal/create-default-adam-cloud-intent-bridge.ts` | `818f230fd16b0a3a012b77f045f0acd59ac18afebcd5b2370b2045e2791da4c4` |
| `dobius/src/main/adam-service-principal/create-default-adam-cloud-intent-bridge.test.ts` | `d6a5ebebb2f928761a857247449e260a68a300e98e8cf039a713bbaf15ec489f` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child-test-fixtures.ts` | `9fb2b00342937ebdf1582923f40145c8f50df27eacea36d7701c032a85907485` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child.test.ts` | `04c1a85031cea48a2ee44e89c6c2e657b7eb89dce5084b017d1671608fa239cb` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child-dispatch.test.ts` | `308616fd7c2a58fde399105b1bfd75fd4f942d960cc1502142c244827856a2a4` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child-lookup.test.ts` | `532be525916984776b5aba8a9b2eb2863c51e495b4426f02945e6e256ff504ca` |
| `dobius/src/shared/cloud-job-adam-intent-wire.ts` | `34de34b0c70683b4abc8d28dbb69af0ff4868f9171ecf57b409f67afd6ff77f9` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-intent-protocol.ts` | `71a12595a9036a8f324d9bf8db4693eab5a19bf8cc066c3f21068e4eb6a4693e` |
| `dobius/src/main/automations/cloud-job-submit-admission.ts` | `fb62cb01c9afff4cf1bed7b53170bf1dffd375719093457c84e4114ba0955fc3` |
| `dobius/src/main/automations/cloud-job-submit-admission-recovery.test.ts` | `8e878fb7f1f05ce2db9e23fd9514acd9063dfdf6bb519983b6fc3dc6c7af3f4a` |
| `dobius/src/main/automations/cloud-job-service.ts` | `a0b7d2b93ce0f3dc7d705f28c1b933819b0903178c866f5b4080caefe067ea6e` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-child-lookup.ts` | `a2c7d8daeb02052179eb2df09b560166c69d02e620bfefe6a474d899e2957889` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-catalog.ts` | `b4024a098e2fd56c650fe837af0f8070d8ee0df5b89f65531f52618294cdc008` |
| `dobius/src/main/runtime/rpc/core.ts` | `9dbb45ba777c8cb8c46221fc2be6095ee544cf5df81b2f67bb0898cffd07dfd0` |
| `dobius/src/main/runtime/rpc/dispatcher.ts` | `9415ba071c16adb92587f6dddc55511e110042ad12a68d22777b6ec4fcccb6c2` |
| `dobius/src/main/runtime/rpc/transport.ts` | `faf82b069dbf2d3d86264e7e564635eeb841d86bead5846e5e82a02a777066d4` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child.ts` | `9619c92dc30ac5d1c86148f2a89f14b3f9fc2a123062eadbba9ca05c273c7994` |
| `dobius/src/main/runtime/runtime-rpc.ts` | `1dd60c75f5f65cae76fc2d3998037aec0c9251d9416d29b2c0426b7d472c2928` |
| `dobius/src/main/index.ts` | `fe8ab4b096ab7d5c8b17dd65aec5dd89193f0fb04d817a7838ee44e85362fa34` |
| `dobius/src/cli/handlers/adam-cloud-child.ts` | `eaf8626f6196b6df9a5b76d20b0363520089a25c037883fbf1f0345cd74ead83` |
| `dobius/src/cli/handlers/adam-cloud-child.test.ts` | `f6a504967a7f61b5e3aff9ad67cf5f58f6d28609ee90c005da2aff4370dc80fb` |
| `dobius/src/cli/specs/adam-cloud-child.ts` | `45eec90367a1f81a91a958a811eced18398f04121b1e35390d453cc90235f2ce` |
| `dobius/src/cli/index.ts` | `04712edbf0cd930ff363253d75f92d2692f0e49ad5f201acaf731f7825bbac00` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-lookup-authority.ts` | `9ce4559587c559771af0801ef8d0b0c3108d561fc4b4871fcdf5c64d14dbbfcb` |
| `dobius/src/main/automations/cloud-job-service-contract.ts` | `65ac5b11e18d6fad8c09ed78150efdbd63721175469652c5bac7801329547bce` |

## Limits

This is source-only acceptance pending independent review. Production principal enrollment and peer evidence remain unavailable by default; synthetic proof, ciphertext, grants, and local temporary SQLite were used only. No production caller may use unseal from this packet alone, and there is no claim of packaged or live acceptance; no service/provider/device/account/keychain or head action was performed. No ADAM candidate was edited; AWS remains deferred and historical Storage remains paused.

## Completion transport

The single required worker completion IPC attempt for task `task_130a3353c219` / dispatch `ctx_353db44c56fe` failed because the running Dobius app connection was unavailable (`Could not connect to the running Dobius app. Dobius is not running.`). No restart or retry was attempted; this report and its matching role JSON receipt are the completion fallback.
