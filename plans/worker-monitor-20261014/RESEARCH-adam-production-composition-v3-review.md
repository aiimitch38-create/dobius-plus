# Independent ADAM production composition candidate V3 review

**Verdict: `CHANGES_REQUIRED`.** V3 fixes the V2 entrypoint's unconditional exit after an incomplete drain, serializes retries, and preserves the post-commit lookup-only recovery after permanent human-decision revocation. Two process-liveness holes still let the OS exit before safe drain: V3 does not hold a referenced handle during the first `service.stop()` attempt, and it does not retain a handle when a signal arrives while a one-shot/prepare operation is pending.

## Review identity and freeze verification

- Review task: `task_1ba68ddda87e`; dispatch: `ctx_191cc095469c`.
- Candidate author: `task_c31f8cefdc18` / `ctx_117be2210cfa`.
- Canonical repository and branch: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, `fix/channel-cost`.
- Author receipt: `plans/cloud-workstation-reports-20261012/build2.json#adam-production-composition-candidate-v3-20261015`.
- Author report: `plans/worker-monitor-20261014/BUILD2-adam-production-composition-candidate-v3.md`, SHA-256 `345432ba7f3f34f4914c121531b5ee296cfdab26144c9f4d1c2b29f3b1cf75ca`.
- V3 manifest / aggregate: `plans/worker-monitor-20261014/adam-production-composition-candidate-v3/manifest.json`, SHA-256 `8ce0583a2f24ca3a3d61d97767c95b3e24676a44522741d3408fcb009555567c`.
- V3 patch SHA-256: `3ac4ce82a8ec2169875bb8cd5009f1cb57a4314f83b866a92522332f9cc955e0`.
- Verified all 81 V3 manifest-listed source/support files and byte counts; the tree contains exactly the 81 entries plus its manifest and no symlinks. Compared all 18 changed/new paths against actual read-only ADAM baseline: 18/18 baseline hashes or declared absences matched.
- Preserved V1 manifest and listed contents: `31d705aed3d657f9436ed0d065c57625f8a5a1ece9d20466fe88499753a25a98`, 76/76 listed files match. Preserved V2 manifest and listed contents: `7fc192a3c8311f5b2d07b662a7cb506276b445741f15ebba9b82c94254c060d4`, 79/79 match. V3 wire-contract map matches the base `f31b56bec89ac9841afed587eea76e6f5ba085c800f0a26e7760ba60a7e26e6f` and recovery `75d3cc984bd37cc2279ddcd3793c08c3b3554812c065250af06bf4b268ffb0ac` contracts.
- V2-to-V3 `approved-decision-store.ts` diff is only removal of the unused `canonicalCloudJobAdamSha256` import; no semantic change.

| Changed/new ADAM path | State | V3 SHA-256 | Actual baseline SHA-256 | Bytes |
|---|---|---|---|---:|
| `service/src/db/migrations.ts` | modified | `ab63f722dcad0b5f42720724fa20bafbb86c8341f688cabafb2de8d015fba8e1` | `dfac6a4eb3e6d694468c3b980820559021b2996f54f808d8ab5735444fede3ec` | 23484 |
| `service/src/dobius-cloud/approved-decision-contract.ts` | new | `7686aea2fbf919bf710c980e72baea4a10238db56a3dcb027e0b24c6596ed046` | `absent` | 3115 |
| `service/src/dobius-cloud/approved-decision-operation.ts` | new | `b49e81e5e6206ad2884ee5e11744640efc3138345169df994e403d1f4827ee01` | `absent` | 4120 |
| `service/src/dobius-cloud/approved-decision-publisher.ts` | new | `a338b4d35c035abaccb4e2bb17e30b7dd23faf750df88a92ceaf16f74e8b1ddf` | `absent` | 17204 |
| `service/src/dobius-cloud/approved-decision-store.ts` | new | `5d3efd14fdb193c472830aa73b5ec52e75ec1b08e728b4471aab9b144f8315fb` | `absent` | 14342 |
| `service/src/dobius-cloud/approved-job-payload.ts` | modified | `9e5b64b0905e8c8a7e9792468fc0248174a4712a7a2893e46e488a950028d054` | `7b478d364798bb28f2dc5d052ca8e06a60f6b1db28de7913146af4a14c7560a5` | 3688 |
| `service/src/dobius-cloud/child-submit.ts` | modified | `e25ac3504169ddae50422e892113ac8676b9ad577296da2b0aee70622a00d46e` | `c1a5408fba3d5dbed7e7187f0764631586f4afd8301dbe260b22d1adfdf57546` | 4688 |
| `service/src/dobius-cloud/intent-bridge-cli.ts` | new | `d2704e5dbf538e6a137bf39b2aa431b442b050b120e12d9b40c9fd40530d4eac` | `absent` | 15424 |
| `service/src/dobius-cloud/intent-contract.ts` | modified | `c7976e8c6aeb3bf1381461233091a9f23cbf01ed7a428b35d1e5221a20a085b9` | `60d148b77864bb83025e1d8cfeb6f0b3883d3d995759df306fbce165880a7ecd` | 1374 |
| `service/src/dobius-cloud/intent-publication.ts` | modified | `3fc65473281cbf4c9f2581d5ac362e777b36508fbf190e021d17ec14134dfe19` | `8248ffc77766abb62c50303bf51fd5a917652899b480a6b714399ff4a0c25544` | 8768 |
| `service/src/dobius-cloud/receipt-store.ts` | modified | `29f10bb72ae5c8943a7945f59c17fc2270374d29ef320695013a3a72a4b92d92` | `f53ffe295a5b27d01934489cef907cca59e9e4a159019bdfcc932a65a5ed5e2a` | 19516 |
| `service/src/main.ts` | modified | `392a0e80a0bf1b940ebb0c804fd7ee2cf619722fdb466093fcacecf018a607a3` | `58159e34ecb3948a2ce809429b92a7da8a484d5683f27eae2bd556ce8bcad066` | 2957 |
| `service/src/runtime/process-lifecycle.ts` | new | `2346808dc5cc314a569d4190730e501fcf2ad524d0de0fceea2fbc29773a734b` | `absent` | 7058 |
| `service/src/runtime/service.ts` | modified | `efb09c9291bccfefba2c77ca77e837b803f6a30b78de5aad66813311f7547b33` | `251b62dd624918e43c27cdaa37ca02a7e3d21c72162fe92ff681196826504862` | 47967 |
| `service/tests/dobius-cloud-approved-decision-publisher.test.ts` | new | `a83c45f6e1aceaa7b5a0040bb551f04ac6fa6104b67efd5ad183bb0d29e772ba` | `absent` | 20094 |
| `service/tests/dobius-cloud-approved-decision-shutdown.test.ts` | new | `250a6738e2c02e023a364cf70fc8605269fa4fdc4a17cb76d400fe14c1b8c20c` | `absent` | 8654 |
| `service/tests/dobius-cloud-receipt-recovery.test.ts` | modified | `7143d13690ed78b9c3973b4e59b6faee45c73f399bceb4a93a1d57be981e8dda` | `33a29ce749fb7d7dd135bcf29f0678e7228daa58e000cad58fd93fabc847d54e` | 2908 |
| `service/tests/process-lifecycle.test.ts` | new | `8124c98199dc4b3124af7d6614dcc61314b457b8a099007548500ac9a10fc457` | `absent` | 8793 |

## Findings

### Blocking: first shutdown attempt can lose process ownership before the retry loop

The production candidate `service/src/main.ts:46-54` now delegates signals to the production-used `runProcessLifecycle`. The coordinator correctly serializes `stop()` calls, catches false/rejected results, and uses a referenced exponential retry wait only after the current stop attempt returns false (`process-lifecycle.ts:147-152,180-221`). But `AdamService.stop()` waits on an overall deadline timer that is explicitly `unref()`'d (`runtime/service.ts:309-332`); its HTTP-close and callback-drain timers are also unref'd (`:70-83,344-358`), as is the publisher's bounded stop timer (`approved-decision-operation.ts:101-119`). Once signal handling closes the server and application intervals are cleared/unref'd, an unresolved promise-only callback does not keep Node alive. The process can therefore exit before the first `stop()` deadline resolves false and before `drainUntilStopped` installs its referenced backoff timer. The new retry loop cannot preserve ownership during this gap.

I reproduced this with a disposable Node 24 child using the same production lifecycle coordinator and a stop deadline backed by an unref'd timer. It printed `READY` and `STOP_CALLED`, then exited naturally with status 0; it never printed `RETRY`. This mirrors the actual V3 service stop's unref'd deadline behavior. The underlying `service.stop()` false case is already exercised using the synthetic server and a never-settling provider, but the test runner's own handles prevent that suite from detecting natural process exit.

**Required correction:** acquire a referenced lifecycle hold synchronously on receipt of a shutdown signal and keep it until a stop result is true; alternatively make the stop deadline timers referenced and ensure one is guaranteed alive for the entire first attempt. Add an isolated child-process regression that invokes the same coordinator, requests a signal, has the stop attempt resolve false after an unref'd deadline, and proves the process remains alive, enters referenced backoff, and only exits after a later true result. Cover rejected stop the same way.

### Blocking: signal during once/prepare can exit while the operation promise is pending

In `process-lifecycle.ts:129-138`, once/prepare mode directly awaits `options.execute()`; unlike service startup (`:94-113`), it neither races the signal promise nor establishes a referenced keepalive. A signal callback only stores `requestedSignal` (`:61-64`); it does not arrange for `stop()` until `execute()` settles and control reaches `:140-152`. A pending promise by itself does not keep Node alive.

A disposable Node 24 child probe invoked the production coordinator in once mode, fired the captured fake signal from `execute()`, and returned a never-settling promise. The child exited naturally with status 0 after printing only `EXECUTE_PENDING`; `stop()` was never called. The same branch handles prepare mode. This contradicts the required process/database ownership on a signal during one-shot work. Existing lifecycle tests cover once/prepare result delay and failures, but not signal during a pending execute or late execute completion after signal (`process-lifecycle.test.ts:63-166,264-279`).

**Required correction:** ensure a referenced operation/lifecycle hold exists while one-shot work is pending, at minimum from signal receipt until the execute path settles and the drain returns true. If cancellation is supported, pass an explicit abort context and prove late completion is inert; otherwise document that the operation is allowed to finish, retain the process/database, then drain. Add once and prepare tests for a signal during unresolved execute, no natural exit before resolution, no output before successful drain, and preserved operation failure/exit status when it completes late.

## What V3 now handles correctly

- SIGINT/SIGTERM handlers are registered before `start()` is awaited (`main.ts:43-55`). A signal during startup waits for startup settlement with a referenced reporting interval and skips the listening-ready callback (`process-lifecycle.ts:89-128`). Startup failures are retained as the primary failure and return exit code 1 only after the drain succeeds.
- Service-mode repeated signals coalesce; stop calls run one at a time. False and rejected drains retry with a 1s-to-10s capped exponential delay; default waits are referenced. There is no arbitrary retry-limit success or `process.exit`, and one-shot/prepare JSON is emitted only after `stop()` returns true (`process-lifecycle.ts:61-64,147-177,180-221`). These properties passed the covered cases.
- The V2 exact recovery behavior remains: the V3 publisher/test hashes for recovery match V2, and the focused test `recovers a post-commit lost ACK after permanent decision revocation through lookup only` passed. Its fake commits the binding and child before dropping the ACK, keeps decision authority permanently revoked, reopens after expiry, and asserts the same child is stored with one lookup and no second submit/seal.
- Startup that never settles is deliberately retained with a referenced interval and periodic status output rather than abandoned. There is no startup deadline/cancellation; this is a fail-safe potentially indefinite wait, which should be acknowledged as an operational limitation.
- V3 remains staged/default-disabled. The actual ADAM checkout and database were not changed, and no production authority, enrollment, CLI, endpoint, or live process was exercised.

## Independent validation

**Focused suite rerun:** the manifest-listed eight test files were bundled with existing dependencies and run under Node v24.18.0. The successful invocation was:

```sh
NODE_PATH='/Users/bayou/dobius/projects/ADAM/node_modules' ./dobius/node_modules/.bin/esbuild \
  plans/worker-monitor-20261014/adam-production-composition-candidate-v3/service/tests/dobius-cloud-approved-decision-publisher.test.ts \
  plans/worker-monitor-20261014/adam-production-composition-candidate-v3/service/tests/dobius-cloud-approved-decision-shutdown.test.ts \
  plans/worker-monitor-20261014/adam-production-composition-candidate-v3/service/tests/dobius-cloud-approved-payload.test.ts \
  plans/worker-monitor-20261014/adam-production-composition-candidate-v3/service/tests/dobius-cloud-child-submit.test.ts \
  plans/worker-monitor-20261014/adam-production-composition-candidate-v3/service/tests/dobius-cloud-intents.test.ts \
  plans/worker-monitor-20261014/adam-production-composition-candidate-v3/service/tests/dobius-cloud-receipt-recovery.test.ts \
  plans/worker-monitor-20261014/adam-production-composition-candidate-v3/service/tests/dobius-cloud-receipts.test.ts \
  plans/worker-monitor-20261014/adam-production-composition-candidate-v3/service/tests/process-lifecycle.test.ts \
  --bundle --platform=node --format=esm --target=node24 --external:yaml \
  --outbase=plans/worker-monitor-20261014/adam-production-composition-candidate-v3/service \
  --outdir=/private/tmp/adam-prod-v3-review-tests-20261015
ln -s /Users/bayou/dobius/projects/ADAM/node_modules /private/tmp/adam-prod-v3-review-tests-20261015/node_modules
/Users/bayou/homebrew/opt/node@24/bin/node --experimental-test-isolation=none --test \
  /private/tmp/adam-prod-v3-review-tests-20261015/tests/dobius-cloud-approved-decision-publisher.test.js \
  /private/tmp/adam-prod-v3-review-tests-20261015/tests/dobius-cloud-approved-decision-shutdown.test.js \
  /private/tmp/adam-prod-v3-review-tests-20261015/tests/dobius-cloud-approved-payload.test.js \
  /private/tmp/adam-prod-v3-review-tests-20261015/tests/dobius-cloud-child-submit.test.js \
  /private/tmp/adam-prod-v3-review-tests-20261015/tests/dobius-cloud-intents.test.js \
  /private/tmp/adam-prod-v3-review-tests-20261015/tests/dobius-cloud-receipt-recovery.test.js \
  /private/tmp/adam-prod-v3-review-tests-20261015/tests/dobius-cloud-receipts.test.js \
  /private/tmp/adam-prod-v3-review-tests-20261015/tests/process-lifecycle.test.js
```

**Result:** exit 0, 65 tests passed, 0 failed across eight files (four `describe` groups in Node's runner summary). The first two attempts exited 1 because I initially linked the absent `ADAM/service/node_modules`, causing `ERR_MODULE_NOT_FOUND: yaml`; I removed only that temporary symlink, linked the existing `/Users/bayou/dobius/projects/ADAM/node_modules`, and the complete suite passed. No package installation occurred. I did not rerun strict typecheck, lint, format, or patch application; those are author-recorded PASS in the V3 receipt.

**Additional disposable probes:** I bundled only the candidate `process-lifecycle.ts` with:

```sh
./dobius/node_modules/.bin/esbuild plans/worker-monitor-20261014/adam-production-composition-candidate-v3/service/src/runtime/process-lifecycle.ts --bundle --platform=node --format=esm --target=node24 --outfile=/private/tmp/adam-prod-v3-review-tests-20261015/process-lifecycle.js
```

Then ran `/Users/bayou/homebrew/opt/node@24/bin/node /private/tmp/adam-prod-v3-review-tests-20261015/main-signal-adapter-gap-probe.mjs` (exit 0). The two child results were:

```text
{"label":"signal-during-once-unresolved","status":0,"signal":null,"stdout":"EXECUTE_PENDING\n","stderr":""}
{"label":"signal-stop-with-unref-deadline","status":0,"signal":null,"stdout":"READY\nSTOP_CALLED\n","stderr":""}
```

Both first probes naturally exited before reaching safe drain. I repeated both with the V3 main adapter behavior (`process.on`/`process.off`) installed and invoked the captured handler directly; results were still status 0 with `READY`/`STOP_CALLED` and no `RETRY`, or `EXECUTE_PENDING` and no `STOP_CALLED`. This confirms signal listeners themselves did not keep these child processes alive. All signals were fake callback invocations; no OS signal was sent and no real service was started.

## Limits

This is a read-only source review of a staged candidate; no candidate/ADAM source, database, actual service, endpoint, credentials, accounts, providers, process signals, installed app, or Git state was changed. Final freeze hashes were rechecked before writing this report. Source-level checks and synthetic tests do not establish a live bridge or production activation; V3 remains default-disabled and unapplied.
