# BUILD1 ADAM dynamic authority lookup correction

Task `task_eafb9d07bfff`; dispatch `ctx_aa6ca03bdc4d`; coordinator `term_02e778a4-11ae-4292-ba0f-49e2473a2ad9`; runtime `f3546568-4e43-479f-bdf2-f53faba443f1`.

Canonical repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`. This correction supersedes the prior 26-file author freeze as the current source candidate; the prior independent review had one remaining dynamic authority finding.

## Result

`CloudJobService.prepareAdamBoundChildLookup()` now includes the live `options.authorityAvailable` callback in its service-owned currentness fence. The reader evaluates that callback whenever authority is asserted: before unseal, after the awaited unseal, immediately before the synchronous SELECT-only lookup, and after the read before response. Callback `false` or an exception aborts; the bridge converts it to the same fixed `AdamCloudIntentBridgeError`. An absent callback remains available under the service’s existing explicit optional-callback semantics.

The independent intent/binding UUID checks, service/store identity and generation fences, project snapshot and monotonic ABA revision, clock correction, registry proof checks, and read-only exact-child validation remain intact.

## Regression evidence

- Failing-before: a real temporary SQLite child plus deferred unseal was run with unchanged service/store/project/proof and `authorityAvailable` toggled true-to-false while suspended. Before adding the live callback to the reader fence, lookup returned the child instead of refusing. After correction it returns the fixed refusal, with identical SQLite project/job/binding/event/outbox snapshots and no consume or submit calls.
- A throwing authority callback after deferred unseal returns the same fixed refusal without exposing its synthetic private error text or changing SQLite rows; no consume or submit occurs.
- Authority disabled before lookup refuses before the unsealer is called. A deterministic authority callback that flips false on the final currentness check refuses after the synchronous read and before the response; it produces no writes and does not expose the looked-up child.
- The distinct intent/binding UUID integration, exact wrong-intent refusal, project ABA, store/service replacement, proof revocation/disposal, expired read-only child, fresh-expired refusal, and receipt/store behavior remain covered by the retained focused suite.

## Verification

Node `v24.18.0`; final focused Vitest run passed **13 files / 148 tests**, maxWorkers=1:

```sh
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/main/adam-service-principal/registry.test.ts src/main/adam-service-principal/create-default-adam-cloud-intent-bridge.test.ts src/main/automations/cloud-jobs/cloud-job-adam-intent-sealer.test.ts src/main/automations/cloud-jobs/cloud-job-adam-intent-unsealer.test.ts src/main/runtime/rpc/methods/adam-cloud-child.test.ts src/main/runtime/rpc/methods/adam-cloud-child-dispatch.test.ts src/main/runtime/rpc/methods/adam-cloud-child-lookup.test.ts src/cli/handlers/adam-cloud-child.test.ts src/main/automations/cloud-job-submit-admission-recovery.test.ts src/main/automations/cloud-jobs/cloud-job-adam-child-lookup.test.ts src/main/automations/cloud-jobs/cloud-job-adam-atomic-events.test.ts src/main/automations/cloud-job-service.test.ts src/main/runtime/runtime-rpc-cloud-jobs.test.ts --maxWorkers=1
```

Both strict checks passed (exit 0):

```sh
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit --composite false --incremental false -p config/tsconfig.node.json
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit --composite false --incremental false -p config/tsconfig.tc.cli.json
```

Scoped `oxlint`, `oxfmt --check`, and `git diff --check` passed (exit 0).

## Frozen source paths and SHA-256

26 exact source/test paths; aggregate is SHA-256 over compact JSON of the sorted path-to-hash map: `d0bde5b35d036aa6cbcb69d85a13d7482f09baa6de8385f43a728c17bd1deddd`.

| Path | SHA-256 |
|---|---|
| `dobius/src/main/adam-service-principal/adam-cloud-intent-bridge.ts` | `63224e4db0ab881cc6afe9f53bc855619294438659280b793c5d17d17bf288c9` |
| `dobius/src/main/adam-service-principal/create-default-adam-cloud-intent-bridge.ts` | `818f230fd16b0a3a012b77f045f0acd59ac18afebcd5b2370b2045e2791da4c4` |
| `dobius/src/main/adam-service-principal/create-default-adam-cloud-intent-bridge.test.ts` | `d6a5ebebb2f928761a857247449e260a68a300e98e8cf039a713bbaf15ec489f` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child-test-fixtures.ts` | `75d15ac6d8b62a19934f7a42a5fc15191b43e052d0a370165d880868ebe56425` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child.test.ts` | `04c1a85031cea48a2ee44e89c6c2e657b7eb89dce5084b017d1671608fa239cb` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child-dispatch.test.ts` | `308616fd7c2a58fde399105b1bfd75fd4f942d960cc1502142c244827856a2a4` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child-lookup.test.ts` | `cdd2450062d211d17fd3b432fcb5e071e267613c1e6d4fb0a704e31da99602cb` |
| `dobius/src/shared/cloud-job-adam-intent-wire.ts` | `34de34b0c70683b4abc8d28dbb69af0ff4868f9171ecf57b409f67afd6ff77f9` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-intent-protocol.ts` | `71a12595a9036a8f324d9bf8db4693eab5a19bf8cc066c3f21068e4eb6a4693e` |
| `dobius/src/main/automations/cloud-job-submit-admission.ts` | `fb62cb01c9afff4cf1bed7b53170bf1dffd375719093457c84e4114ba0955fc3` |
| `dobius/src/main/automations/cloud-job-submit-admission-recovery.test.ts` | `8e878fb7f1f05ce2db9e23fd9514acd9063dfdf6bb519983b6fc3dc6c7af3f4a` |
| `dobius/src/main/automations/cloud-job-service.ts` | `da48ea4e5950512c48d9291d5f10e14632504b340ca2df3c2c05ab640b6a2f61` |
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

This is a source-only candidate pending independent re-review. Tests used synthetic service callbacks, peers/grants/ciphertext and temporary SQLite; no production configuration, enrollment, service, provider, device, private account, keychain, or Hermes head was read or called. The default principal registry/transport remains unavailable; no installed/packaged/live recovery acceptance is claimed. No BUILD2 candidate or actual ADAM source was changed; AWS remains deferred and historical Storage remains paused.

## Completion transport

The single worker_done IPC attempt for task `task_eafb9d07bfff` / dispatch `ctx_aa6ca03bdc4d` failed because Dobius was unavailable (`Could not connect to the running Dobius app. Dobius is not running.`). No restart or retry was attempted; this report and the matching `build1.json` receipt are the completion fallback.
