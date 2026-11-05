# ADAM production composition candidate V3: process shutdown ownership

Task: `task_c31f8cefdc18` / `ctx_117be2210cfa`  
Verdict: immutable source candidate ready for independent review; actual ADAM remains read-only.

V3 preserves V1 manifest `31d705aed3d657f9436ed0d065c57625f8a5a1ece9d20466fe88499753a25a98` and V2 manifest `7fc192a3c8311f5b2d07b662a7cb506276b445741f15ebba9b82c94254c060d4` byte-for-byte. The base request wire and lookup-only recovery wire are unchanged. Candidate manifest SHA-256: `8ce0583a2f24ca3a3d61d97767c95b3e24676a44522741d3408fcb009555567c`; application patch SHA-256: `3ac4ce82a8ec2169875bb8cd5009f1cb57a4314f83b866a92522332f9cc955e0`.

## Entrypoint correction

The real staged service entrypoint now delegates every completion path to the production-used process lifecycle coordinator. It registers SIGINT/SIGTERM handlers before startup, and if a signal arrives during startup it retains a referenced keepalive until startup settles before beginning the drain. One-shot and prepare-tomorrow operations hold their machine-readable JSON until the service drain returns true.

Drain calls are serialized: false and rejected `stop(timeoutMs)` results produce bounded stderr diagnostics and an exponential 1-second-to-10-second retry delay; the referenced timer and owning process remain alive until a retry returns true. Repeated signals coalesce instead of starting concurrent stop calls. Startup/operation failures remain visible and set nonzero exit status only after the same safe drain; no path emits clean success or returns early after false. An emergency entrypoint catch uses the same drain-until-true retry routine.

The candidate does not change stop() semantics, close a database with unresolved callbacks, force process exit, or enable decision/custody providers.

## Frozen changed/new source files (18)

| State | Candidate path | Actual ADAM baseline SHA-256 | Candidate SHA-256 | Bytes |
|---|---|---|---|---:|
| modified | `service/src/db/migrations.ts` | dfac6a4eb3e6d694468c3b980820559021b2996f54f808d8ab5735444fede3ec | ab63f722dcad0b5f42720724fa20bafbb86c8341f688cabafb2de8d015fba8e1 | 23484 |
| new | `service/src/dobius-cloud/approved-decision-contract.ts` | absent | 7686aea2fbf919bf710c980e72baea4a10238db56a3dcb027e0b24c6596ed046 | 3115 |
| new | `service/src/dobius-cloud/approved-decision-operation.ts` | absent | b49e81e5e6206ad2884ee5e11744640efc3138345169df994e403d1f4827ee01 | 4120 |
| new | `service/src/dobius-cloud/approved-decision-publisher.ts` | absent | a338b4d35c035abaccb4e2bb17e30b7dd23faf750df88a92ceaf16f74e8b1ddf | 17204 |
| new | `service/src/dobius-cloud/approved-decision-store.ts` | absent | 5d3efd14fdb193c472830aa73b5ec52e75ec1b08e728b4471aab9b144f8315fb | 14342 |
| modified | `service/src/dobius-cloud/approved-job-payload.ts` | 7b478d364798bb28f2dc5d052ca8e06a60f6b1db28de7913146af4a14c7560a5 | 9e5b64b0905e8c8a7e9792468fc0248174a4712a7a2893e46e488a950028d054 | 3688 |
| modified | `service/src/dobius-cloud/child-submit.ts` | c1a5408fba3d5dbed7e7187f0764631586f4afd8301dbe260b22d1adfdf57546 | e25ac3504169ddae50422e892113ac8676b9ad577296da2b0aee70622a00d46e | 4688 |
| new | `service/src/dobius-cloud/intent-bridge-cli.ts` | absent | d2704e5dbf538e6a137bf39b2aa431b442b050b120e12d9b40c9fd40530d4eac | 15424 |
| modified | `service/src/dobius-cloud/intent-contract.ts` | 60d148b77864bb83025e1d8cfeb6f0b3883d3d995759df306fbce165880a7ecd | c7976e8c6aeb3bf1381461233091a9f23cbf01ed7a428b35d1e5221a20a085b9 | 1374 |
| modified | `service/src/dobius-cloud/intent-publication.ts` | 8248ffc77766abb62c50303bf51fd5a917652899b480a6b714399ff4a0c25544 | 3fc65473281cbf4c9f2581d5ac362e777b36508fbf190e021d17ec14134dfe19 | 8768 |
| modified | `service/src/dobius-cloud/receipt-store.ts` | f53ffe295a5b27d01934489cef907cca59e9e4a159019bdfcc932a65a5ed5e2a | 29f10bb72ae5c8943a7945f59c17fc2270374d29ef320695013a3a72a4b92d92 | 19516 |
| modified | `service/src/main.ts` | 58159e34ecb3948a2ce809429b92a7da8a484d5683f27eae2bd556ce8bcad066 | 392a0e80a0bf1b940ebb0c804fd7ee2cf619722fdb466093fcacecf018a607a3 | 2957 |
| new | `service/src/runtime/process-lifecycle.ts` | absent | 2346808dc5cc314a569d4190730e501fcf2ad524d0de0fceea2fbc29773a734b | 7058 |
| modified | `service/src/runtime/service.ts` | 251b62dd624918e43c27cdaa37ca02a7e3d21c72162fe92ff681196826504862 | efb09c9291bccfefba2c77ca77e837b803f6a30b78de5aad66813311f7547b33 | 47967 |
| new | `service/tests/dobius-cloud-approved-decision-publisher.test.ts` | absent | a83c45f6e1aceaa7b5a0040bb551f04ac6fa6104b67efd5ad183bb0d29e772ba | 20094 |
| new | `service/tests/dobius-cloud-approved-decision-shutdown.test.ts` | absent | 250a6738e2c02e023a364cf70fc8605269fa4fdc4a17cb76d400fe14c1b8c20c | 8654 |
| modified | `service/tests/dobius-cloud-receipt-recovery.test.ts` | 33a29ce749fb7d7dd135bcf29f0678e7228daa58e000cad58fd93fabc847d54e | 7143d13690ed78b9c3973b4e59b6faee45c73f399bceb4a93a1d57be981e8dda | 2908 |
| new | `service/tests/process-lifecycle.test.ts` | absent | 8124c98199dc4b3124af7d6614dcc61314b457b8a099007548500ac9a10fc457 | 8793 |

Manifest covers 78 source/test files and 3 support files (81 regular files excluding the manifest). All listed sizes and hashes were verified and the candidate tree contains no symlinks. The generated patch was checked and applied only in a disposable tree reconstructed from the exact actual ADAM baseline; all 18 changed/new source files were byte-identical after application.

## Verification

- **Focused tests:** 65/65 passed across eight test files: 55 preserved V1/V2 regressions and ten lifecycle tests. Coverage includes one-shot/prepare output-after-drain, persistent false, rejection/recovery, startup failure, operation failure, duplicate signals, signal during startup, serialized stop attempts, and the existing SQLite/synthetic HTTP incomplete-shutdown regression.
- **Strict typecheck:** Node v24.18.0, TypeScript strict NodeNext noEmit over main, lifecycle coordinator/tests, and the V2 publisher/shutdown tests with recursive imports. Passed.
- **Lint:** oxlint 1.71.0 --deny-warnings across all 18 changed/new TypeScript paths. Passed after removing one unused import from the staged candidate.
- **Format:** oxfmt --check passed for the nine selected new/updated files. No ADAM formatter config was found; V1/V2 style outside that selected set was preserved.
- **Patch:** git apply --check -p1 and disposable application passed against exact actual source baselines.

Test command and exact file list are recorded in `adam-production-composition-candidate-v3/manifest.json`. The first ESM test execution could not resolve external YAML from its temporary output; linking the existing read-only ADAM node_modules into that temporary output fixed resolution, and the complete rerun passed. No dependencies were installed.

## Remaining limits

This is a staged candidate only. Actual ADAM source, live database, service, credentials, accounts, providers, endpoints, and process signals were not touched. The service-level test uses a synthetic HTTP server/request because local socket creation is sandbox-blocked; lifecycle tests use fake signals/timers and the same coordinator called by main.ts. Independent V3 review and joint integration remain required. AWS remains deferred and the historical Storage queue remains paused.
