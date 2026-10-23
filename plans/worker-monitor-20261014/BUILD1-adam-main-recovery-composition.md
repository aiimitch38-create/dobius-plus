# BUILD1 ADAM main recovery-composition source packet

Task `task_3bca6e58b215`; dispatch `ctx_5f9101dd405a`. Canonical repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`.

## Result

Implemented the ROOT additive `adam.lookupApprovedIntent` / `lookup-adam-child --request-stdin --json` recovery path and corrected admission's expiry preflight to use the catalog's validated store clock. The base approved-intent wire is unchanged (SHA-256 `f31b56bec89ac9841afed587eea76e6f5ba085c800f0a26e7760ba60a7e26e6f`); the additive recovery wire is SHA-256 `75d3cc984bd37cc2279ddcd3793c08c3b3554812c065250af06bf4b268ffb0ac`.

Lookup uses the same strict submit request packet but a separately authorized `adam.lookupApprovedIntent` method/resource. The main bridge verifies current transport-backed service proof and credential before unsealing, then reauthorizes after unseal and immediately before the synchronous local query and response. The query validates the exact persisted consumed binding identity/digest, creator and request key, full canonical job input and stored fingerprint; it returns that existing child or `null`. It does not call ADAM, consume a grant, submit, reseal, renew TTL, or write jobs, bindings, events, receipts, outbox, or executor state. Expired sealed identity is accepted only for this exact existing-child read. Revoked decision authority does not disable the independently authenticated observation path; revoked service credentials still refuse.

The store-clock regression sets the wall clock ahead of the store clock and proves a fresh grant is admitted; the existing expired-store-clock case continues to refuse without writes. Real temporary SQLite/store tests cover exact expired-child recovery, absent lookup, mismatched identity, unchanged DB snapshots, and no consume/submit. Dispatcher tests require transport-context peer evidence; request-body peer claims fail. Separate lookup method enrollment is required. CLI accepts bounded stdin only and suppresses remote selection. Default production registry remains unavailable, so the real production ingress refuses before crypto or store effects.

## Exact source/test freeze

All paths below are current at this packet freeze; SHA-256 values are recomputed from the canonical checkout.

| Path | SHA-256 |
|---|---|
| `dobius/src/main/adam-service-principal/adam-cloud-intent-bridge.ts` | `c2690411b9e64ac7704a892925eeebd6e72e4079f68767b867858ba2776034dd` |
| `dobius/src/main/adam-service-principal/create-default-adam-cloud-intent-bridge.ts` | `818f230fd16b0a3a012b77f045f0acd59ac18afebcd5b2370b2045e2791da4c4` |
| `dobius/src/main/adam-service-principal/create-default-adam-cloud-intent-bridge.test.ts` | `d6a5ebebb2f928761a857247449e260a68a300e98e8cf039a713bbaf15ec489f` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child-test-fixtures.ts` | `1d310933e893a2fc19edd533226559be3d695a1d1c3eb6983feae2c406f16272` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child.test.ts` | `04c1a85031cea48a2ee44e89c6c2e657b7eb89dce5084b017d1671608fa239cb` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child-dispatch.test.ts` | `308616fd7c2a58fde399105b1bfd75fd4f942d960cc1502142c244827856a2a4` |
| `dobius/src/main/runtime/rpc/methods/adam-cloud-child-lookup.test.ts` | `0ae1a56f3f4dac5be96974254f62887b82b0d6f5f985ddfa8aa3921b69b41217` |
| `dobius/src/shared/cloud-job-adam-intent-wire.ts` | `34de34b0c70683b4abc8d28dbb69af0ff4868f9171ecf57b409f67afd6ff77f9` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-intent-protocol.ts` | `71a12595a9036a8f324d9bf8db4693eab5a19bf8cc066c3f21068e4eb6a4693e` |
| `dobius/src/main/automations/cloud-job-submit-admission.ts` | `fb62cb01c9afff4cf1bed7b53170bf1dffd375719093457c84e4114ba0955fc3` |
| `dobius/src/main/automations/cloud-job-submit-admission-recovery.test.ts` | `8e878fb7f1f05ce2db9e23fd9514acd9063dfdf6bb519983b6fc3dc6c7af3f4a` |
| `dobius/src/main/automations/cloud-job-service.ts` | `f52278c12991829ea757f5fd944db57e8696f546fae11f5a14425ccb2abe462d` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-adam-child-lookup.ts` | `a2c7d8daeb02052179eb2df09b560166c69d02e620bfefe6a474d899e2957889` |
| `dobius/src/main/automations/cloud-jobs/cloud-job-catalog.ts` | `2f8703a5b3006b27d93885bcd766821fa6be965fd2017d35455ed6896326ac85` |
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

## Verification

Node 24.18.0; final focused run passed **13 files, 140 tests**, `--maxWorkers=1`:

```text
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/main/adam-service-principal/registry.test.ts src/main/adam-service-principal/create-default-adam-cloud-intent-bridge.test.ts src/main/automations/cloud-jobs/cloud-job-adam-intent-sealer.test.ts src/main/automations/cloud-jobs/cloud-job-adam-intent-unsealer.test.ts src/main/runtime/rpc/methods/adam-cloud-child.test.ts src/main/runtime/rpc/methods/adam-cloud-child-dispatch.test.ts src/main/runtime/rpc/methods/adam-cloud-child-lookup.test.ts src/cli/handlers/adam-cloud-child.test.ts src/main/automations/cloud-job-submit-admission-recovery.test.ts src/main/automations/cloud-jobs/cloud-job-adam-child-lookup.test.ts src/main/automations/cloud-jobs/cloud-job-adam-atomic-events.test.ts src/main/automations/cloud-job-service.test.ts src/main/runtime/runtime-rpc-cloud-jobs.test.ts --maxWorkers=1
```

Strict TypeScript checks passed (exit 0):

```text
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit --composite false --incremental false -p config/tsconfig.node.json
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit --composite false --incremental false -p config/tsconfig.tc.cli.json
```

Scoped `oxlint` and `oxfmt --check` passed across all 24 frozen owned paths; `git diff --check` passed. The final Node suite also reran after the last source change.

## Limits and remaining gates

This is a bounded source packet, not installed or live acceptance. The production registry is still `unavailable()` and current Unix transport supplies no ADAM peer evidence; no actual enrollment, credential creation, keychain, provider, account, head, service, device, or RPC/CLI calls were made. The lookup does not implement the ADAM-side durable recovery caller; the separate BUILD2 owner remains untouched. Independent review and joint synthetic integration remain required. AWS is deferred and the historical Storage queue remains paused.

The one required `worker_done` IPC attempt for task `task_3bca6e58b215` / dispatch `ctx_5f9101dd405a` failed because the running Dobius app connection was unavailable. No restart or retry was attempted; this report and the matching `build1.json` receipt are the completion fallback.
