# ADAM production composition candidate V4

**Status:** immutable staged candidate pending independent review; not applied to ADAM.

- Task / dispatch: `task_870200e6587d` / `ctx_65f0283a235a`.
- Canonical repo / branch: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, `fix/channel-cost`.
- Current review SHA: `8b5fdfb583701b039e1070a99f470a0840bd3d8f8cbaeb440e93f17d579e7049` (`RESEARCH-adam-production-composition-v3-review.md`, CHANGES_REQUIRED).
- V3 manifest SHA preserved: `8ce0583a2f24ca3a3d61d97767c95b3e24676a44522741d3408fcb009555567c`; V1 `31d705aed3d657f9436ed0d065c57625f8a5a1ece9d20466fe88499753a25a98`; V2 `7fc192a3c8311f5b2d07b662a7cb506276b445741f15ebba9b82c94254c060d4`.
- V4 root: `plans/worker-monitor-20261014/adam-production-composition-candidate-v4`; manifest SHA-256 `ddb8bc73f8521af2563cf32cf1d67c1ae20c77fc3db7e65dfe7b22b24d38a96e`; patch SHA-256 `ff3ffd0ff9d138e04de3f58ecccc279c962c123755dd2fe831cf1e3d3c93db2d`.

## Correction

V3 could naturally exit before its first stop promise resolved because the service stop deadlines are unref’d, and it could exit while a signaled once/prepare `execute()` promise remained unresolved. V4 adds a referenced interval owner synchronously at lifecycle entry and holds it through startup or the one-shot operation, shutdown attempts/retries, and post-drain status/output. The direct exported `drainUntilStopped` helper acquires its own hold for callers outside the lifecycle wrapper. Each hold is released once only after a `true` drain; successful children then exit naturally.

Once/prepare operations are allowed to settle after a signal; the process/database remain owned while they run, then the service drains. A late operation failure keeps exit code 1, and success JSON remains after successful drain only. Duplicate signals coalesce; false/rejected stop attempts remain serialized and use bounded retry/backoff. V4 adds no cancellation or force-exit path.

## Failing-before evidence from frozen V3

- Probe source SHA-256: `c6691277f266bad2d9ffdec27fc70cddcaf897e5b832f211d9c6daf8a4687c14`; command: `/Users/bayou/homebrew/opt/node@24/bin/node /private/tmp/adam-prod-v3-review-tests-20261015/main-signal-adapter-gap-probe.mjs`.
- Reproduced outputs: stop case exited naturally with status 0 and only `READY` / `STOP_CALLED` (no `RETRY`); once case exited naturally with status 0 and only `EXECUTE_PENDING` (no `STOP_CALLED`). The probe ran disposable child processes against the frozen V3 bundle and sent no OS/user process signals.

## Verification

- Node v24.18.0 focused suite: **70 passed, 0 failed** across nine test files; all 65 V3 tests are preserved, with five isolated child-process cases added.
- The child tests use fake signal callbacks, ignored stdin, no IPC, and unref’d fixture timers for stop/execute completion. A parent watchdog can kill only the test-owned child. Coverage includes first false stop then retry, first rejected stop then retry, direct drain helper ownership, duplicate signal coalescing, once/prepare signal during pending execution, late success/failure, no output before safe drain, and natural exit after successful drain.
- Strict NodeNext `tsc --noEmit --strict` passed for main, lifecycle coordinator/hold, existing lifecycle tests, new child test/fixture, and V2 publisher/shutdown tests with recursive imports.
- Scoped `oxlint --deny-warnings --no-ignore` and `oxfmt --check` passed on the five changed/new lifecycle TypeScript files.
- Patch `--dry-run -p1` and application passed only in disposable `/private/tmp/adam-prod-v4-patch2-20261015`; all 21 changed/new source files were byte-identical to V4 afterward.
- Manifest integrity: 81 source/test entries plus 3 support entries (84 regular files excluding manifest) verified for exact SHA-256 and bytes; candidate has no symlinks. The manifest lists all 21 changed/new paths and baseline hashes.

### Commands

Focused test build/run:

```sh
NODE_PATH=/Users/bayou/dobius/projects/ADAM/node_modules ./dobius/node_modules/.bin/esbuild plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/dobius-cloud-approved-decision-publisher.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/dobius-cloud-approved-decision-shutdown.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/dobius-cloud-approved-payload.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/dobius-cloud-child-submit.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/dobius-cloud-intents.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/dobius-cloud-receipt-recovery.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/dobius-cloud-receipts.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/process-lifecycle.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/process-lifecycle-child.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/process-lifecycle-child-fixture.ts --bundle --platform=node --format=esm --target=node24 --external:yaml --outbase=plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service --outdir=/private/tmp/adam-prod-v4-tests-20261015; /Users/bayou/homebrew/opt/node@24/bin/node --experimental-test-isolation=none --test --test-concurrency=1 /private/tmp/adam-prod-v4-tests-20261015/tests/dobius-cloud-approved-decision-publisher.test.js /private/tmp/adam-prod-v4-tests-20261015/tests/dobius-cloud-approved-decision-shutdown.test.js /private/tmp/adam-prod-v4-tests-20261015/tests/dobius-cloud-approved-payload.test.js /private/tmp/adam-prod-v4-tests-20261015/tests/dobius-cloud-child-submit.test.js /private/tmp/adam-prod-v4-tests-20261015/tests/dobius-cloud-intents.test.js /private/tmp/adam-prod-v4-tests-20261015/tests/dobius-cloud-receipt-recovery.test.js /private/tmp/adam-prod-v4-tests-20261015/tests/dobius-cloud-receipts.test.js /private/tmp/adam-prod-v4-tests-20261015/tests/process-lifecycle.test.js /private/tmp/adam-prod-v4-tests-20261015/tests/process-lifecycle-child.test.js
```

Strict typecheck (candidate copied to disposable tree, existing ADAM dependencies linked read-only):

```sh
/Users/bayou/homebrew/opt/node@24/bin/node /Users/bayou/dobius/projects/ADAM/node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --skipLibCheck --allowImportingTsExtensions src/main.ts src/runtime/process-lifecycle.ts src/runtime/process-lifecycle-hold.ts tests/process-lifecycle.test.ts tests/process-lifecycle-child.test.ts tests/process-lifecycle-child-fixture.ts tests/dobius-cloud-approved-decision-publisher.test.ts tests/dobius-cloud-approved-decision-shutdown.test.ts (run in disposable copied V4 service with existing ADAM node_modules symlink)
```

Scoped lint:

```sh
./dobius/node_modules/.bin/oxlint --deny-warnings --no-ignore plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/src/runtime/process-lifecycle.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/src/runtime/process-lifecycle-hold.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/process-lifecycle.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/process-lifecycle-child.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/process-lifecycle-child-fixture.ts
```

Scoped format:

```sh
./dobius/node_modules/.bin/oxfmt --check plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/src/runtime/process-lifecycle.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/src/runtime/process-lifecycle-hold.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/process-lifecycle.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/process-lifecycle-child.test.ts plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service/tests/process-lifecycle-child-fixture.ts
```

Patch validation used `/usr/bin/patch --dry-run -p1` then `/usr/bin/patch -p1` in disposable `/private/tmp/adam-prod-v4-patch2-20261015` reconstructed only from the exact original baseline files; no Git apply, repository source mutation, dependency installation, or ADAM write occurred.

## Complete changed/new source freeze

| Status | Candidate path | Actual ADAM baseline SHA-256 | V4 SHA-256 | Bytes |
|---|---|---|---|---:|
| modified | `service/src/db/migrations.ts` | `dfac6a4eb3e6d694468c3b980820559021b2996f54f808d8ab5735444fede3ec` | `ab63f722dcad0b5f42720724fa20bafbb86c8341f688cabafb2de8d015fba8e1` | 23484 |
| new | `service/src/dobius-cloud/approved-decision-contract.ts` | `absent` | `7686aea2fbf919bf710c980e72baea4a10238db56a3dcb027e0b24c6596ed046` | 3115 |
| new | `service/src/dobius-cloud/approved-decision-operation.ts` | `absent` | `b49e81e5e6206ad2884ee5e11744640efc3138345169df994e403d1f4827ee01` | 4120 |
| new | `service/src/dobius-cloud/approved-decision-publisher.ts` | `absent` | `a338b4d35c035abaccb4e2bb17e30b7dd23faf750df88a92ceaf16f74e8b1ddf` | 17204 |
| new | `service/src/dobius-cloud/approved-decision-store.ts` | `absent` | `5d3efd14fdb193c472830aa73b5ec52e75ec1b08e728b4471aab9b144f8315fb` | 14342 |
| modified | `service/src/dobius-cloud/approved-job-payload.ts` | `7b478d364798bb28f2dc5d052ca8e06a60f6b1db28de7913146af4a14c7560a5` | `9e5b64b0905e8c8a7e9792468fc0248174a4712a7a2893e46e488a950028d054` | 3688 |
| modified | `service/src/dobius-cloud/child-submit.ts` | `c1a5408fba3d5dbed7e7187f0764631586f4afd8301dbe260b22d1adfdf57546` | `e25ac3504169ddae50422e892113ac8676b9ad577296da2b0aee70622a00d46e` | 4688 |
| new | `service/src/dobius-cloud/intent-bridge-cli.ts` | `absent` | `d2704e5dbf538e6a137bf39b2aa431b442b050b120e12d9b40c9fd40530d4eac` | 15424 |
| modified | `service/src/dobius-cloud/intent-contract.ts` | `60d148b77864bb83025e1d8cfeb6f0b3883d3d995759df306fbce165880a7ecd` | `c7976e8c6aeb3bf1381461233091a9f23cbf01ed7a428b35d1e5221a20a085b9` | 1374 |
| modified | `service/src/dobius-cloud/intent-publication.ts` | `8248ffc77766abb62c50303bf51fd5a917652899b480a6b714399ff4a0c25544` | `3fc65473281cbf4c9f2581d5ac362e777b36508fbf190e021d17ec14134dfe19` | 8768 |
| modified | `service/src/dobius-cloud/receipt-store.ts` | `f53ffe295a5b27d01934489cef907cca59e9e4a159019bdfcc932a65a5ed5e2a` | `29f10bb72ae5c8943a7945f59c17fc2270374d29ef320695013a3a72a4b92d92` | 19516 |
| modified | `service/src/main.ts` | `58159e34ecb3948a2ce809429b92a7da8a484d5683f27eae2bd556ce8bcad066` | `392a0e80a0bf1b940ebb0c804fd7ee2cf619722fdb466093fcacecf018a607a3` | 2957 |
| new | `service/src/runtime/process-lifecycle-hold.ts` | `absent` | `042e075774d56c876e92f0a0473c0c284de2792079d33081bd9893370cf19aee` | 349 |
| new | `service/src/runtime/process-lifecycle.ts` | `absent` | `00019ee9f8e4a643414e9c6150801b34ddd4e8185d9eed819ca8cb98fa924c3b` | 8101 |
| modified | `service/src/runtime/service.ts` | `251b62dd624918e43c27cdaa37ca02a7e3d21c72162fe92ff681196826504862` | `efb09c9291bccfefba2c77ca77e837b803f6a30b78de5aad66813311f7547b33` | 47967 |
| new | `service/tests/dobius-cloud-approved-decision-publisher.test.ts` | `absent` | `a83c45f6e1aceaa7b5a0040bb551f04ac6fa6104b67efd5ad183bb0d29e772ba` | 20094 |
| new | `service/tests/dobius-cloud-approved-decision-shutdown.test.ts` | `absent` | `250a6738e2c02e023a364cf70fc8605269fa4fdc4a17cb76d400fe14c1b8c20c` | 8654 |
| modified | `service/tests/dobius-cloud-receipt-recovery.test.ts` | `33a29ce749fb7d7dd135bcf29f0678e7228daa58e000cad58fd93fabc847d54e` | `7143d13690ed78b9c3973b4e59b6faee45c73f399bceb4a93a1d57be981e8dda` | 2908 |
| new | `service/tests/process-lifecycle-child-fixture.ts` | `absent` | `96ce1ba304e59a5bd07b660b1b1484ee01c909cba2b622668c8d499f67588032` | 2764 |
| new | `service/tests/process-lifecycle-child.test.ts` | `absent` | `fc0eff5ad5fdfa9f85a1d2b125b232364f96f088b08afa57a2c99affa0573fa7` | 4391 |
| new | `service/tests/process-lifecycle.test.ts` | `absent` | `8124c98199dc4b3124af7d6614dcc61314b457b8a099007548500ac9a10fc457` | 8793 |

The full tree and test/support hashes are in [`manifest.json`](adam-production-composition-candidate-v4/manifest.json); application patch: [`adam-production-composition.patch`](adam-production-composition-candidate-v4/patches/adam-production-composition.patch).

## Limits

Actual ADAM source/database and the accepted Dobius source were not changed. No service/account/provider/credential/keychain/head/endpoint action, install, build, deploy, or live acceptance occurred; dispatch remains disabled. A never-settling one-shot operation or permanently incomplete drain safely retains the process indefinitely. Independent V4 review is still required before integration. AWS remains deferred and the historical Storage queue remains paused.
