# ADAM production composition candidate V2

Task: `task_d6d018ade0b3` / `ctx_dd6f7dfdc915`  
Status: immutable review candidate; not applied to actual ADAM.

V2 preserves the original V1 candidate (manifest SHA-256 `31d705aed3d657f9436ed0d065c57625f8a5a1ece9d20466fe88499753a25a98`) and the shared approved-intent wire contract (`f31b56bec89ac9841afed587eea76e6f5ba085c800f0a26e7760ba60a7e26e6f`) plus additive lookup-only recovery contract (`75d3cc984bd37cc2279ddcd3793c08c3b3554812c065250af06bf4b268ffb0ac`). The V2 manifest SHA-256 is `7fc192a3c8311f5b2d07b662a7cb506276b445741f15ebba9b82c94254c060d4`; it records every candidate/support file and the disposable-application patch SHA-256 `b7a244744038809a1ba76f9dfa5f2c481c0c5bcbd129e364781c2a6089283bb5`.

The operation runner gives each decision/provider/CLI operation a 45-second deadline, propagates abort and generation context, and retains unsettled work in the drain fence when a provider ignores cancellation. AdamService.stop() uses a bounded shared drain, initiates publisher cancellation before waiting on HTTP shutdown, tracks active callbacks, and only closes the shared database after all drains are proven. An incomplete drain reports false and retains the database; a later stop may finish cleanup. Dispatch refuses new work after stopping starts.

For a published immutable intent, recovery first performs authenticated lookup-only using the current service credential and exact request packet. A confirmed matching child is recorded as the same observed child even if the original human decision was permanently revoked or expired. A null result can proceed only through fresh exact decision resolution while original approval and intent expiry remain valid; absent, revoked, expired, mismatched, or unauthorized cases do not submit, reseal, mint IDs, or renew expiry.

## Frozen changed/new source files

| State | Candidate path | Actual ADAM baseline SHA-256 | Candidate SHA-256 | Bytes |
|---|---|---|---|---:|
| modified | `service/src/db/migrations.ts` | dfac6a4eb3e6d694468c3b980820559021b2996f54f808d8ab5735444fede3ec | ab63f722dcad0b5f42720724fa20bafbb86c8341f688cabafb2de8d015fba8e1 | 23484 |
| new | `service/src/dobius-cloud/approved-decision-contract.ts` | absent | 7686aea2fbf919bf710c980e72baea4a10238db56a3dcb027e0b24c6596ed046 | 3115 |
| new | `service/src/dobius-cloud/approved-decision-operation.ts` | absent | b49e81e5e6206ad2884ee5e11744640efc3138345169df994e403d1f4827ee01 | 4120 |
| new | `service/src/dobius-cloud/approved-decision-publisher.ts` | absent | a338b4d35c035abaccb4e2bb17e30b7dd23faf750df88a92ceaf16f74e8b1ddf | 17204 |
| new | `service/src/dobius-cloud/approved-decision-store.ts` | absent | a1f2a0590efbace27a5d2d11716c629bd8de037aaf526280aeaa3186754d2c5f | 14371 |
| modified | `service/src/dobius-cloud/approved-job-payload.ts` | 7b478d364798bb28f2dc5d052ca8e06a60f6b1db28de7913146af4a14c7560a5 | 9e5b64b0905e8c8a7e9792468fc0248174a4712a7a2893e46e488a950028d054 | 3688 |
| modified | `service/src/dobius-cloud/child-submit.ts` | c1a5408fba3d5dbed7e7187f0764631586f4afd8301dbe260b22d1adfdf57546 | e25ac3504169ddae50422e892113ac8676b9ad577296da2b0aee70622a00d46e | 4688 |
| new | `service/src/dobius-cloud/intent-bridge-cli.ts` | absent | d2704e5dbf538e6a137bf39b2aa431b442b050b120e12d9b40c9fd40530d4eac | 15424 |
| modified | `service/src/dobius-cloud/intent-contract.ts` | 60d148b77864bb83025e1d8cfeb6f0b3883d3d995759df306fbce165880a7ecd | c7976e8c6aeb3bf1381461233091a9f23cbf01ed7a428b35d1e5221a20a085b9 | 1374 |
| modified | `service/src/dobius-cloud/intent-publication.ts` | 8248ffc77766abb62c50303bf51fd5a917652899b480a6b714399ff4a0c25544 | 3fc65473281cbf4c9f2581d5ac362e777b36508fbf190e021d17ec14134dfe19 | 8768 |
| modified | `service/src/dobius-cloud/receipt-store.ts` | f53ffe295a5b27d01934489cef907cca59e9e4a159019bdfcc932a65a5ed5e2a | 29f10bb72ae5c8943a7945f59c17fc2270374d29ef320695013a3a72a4b92d92 | 19516 |
| modified | `service/src/runtime/service.ts` | 251b62dd624918e43c27cdaa37ca02a7e3d21c72162fe92ff681196826504862 | efb09c9291bccfefba2c77ca77e837b803f6a30b78de5aad66813311f7547b33 | 47967 |
| new | `service/tests/dobius-cloud-approved-decision-publisher.test.ts` | absent | a83c45f6e1aceaa7b5a0040bb551f04ac6fa6104b67efd5ad183bb0d29e772ba | 20094 |
| new | `service/tests/dobius-cloud-approved-decision-shutdown.test.ts` | absent | 250a6738e2c02e023a364cf70fc8605269fa4fdc4a17cb76d400fe14c1b8c20c | 8654 |
| modified | `service/tests/dobius-cloud-receipt-recovery.test.ts` | 33a29ce749fb7d7dd135bcf29f0678e7228daa58e000cad58fd93fabc847d54e | 7143d13690ed78b9c3973b4e59b6faee45c73f399bceb4a93a1d57be981e8dda | 2908 |

The complete manifest lists 76 source/test files plus 3 support files (79 regular files, excluding the manifest); all paths were rehashed and matched exact byte counts and SHA-256 values. V1 manifest hash remained unchanged. Patch validation rebuilt a disposable tree from exact baseline files and passed `git apply --check -p1`; applying it there reproduced all 15 changed/new source files byte-for-byte. Actual ADAM remained read-only.

## Verification

- Focused synthetic suite: **55/55 passed** across seven suites, including corrected post-commit lost-ACK recovery after permanent decision revocation, lookup-only confirmation of the same child, no second submit/reseal/renewal, unauthorized lookup refusal, bounded startup/shutdown, and V1 regressions.
- Strict TypeScript: **passed** NodeNext tsc --noEmit --strict for service runtime, operation/decision/publisher, bridge, child-submit and focused tests.
- Lint: **passed**, oxlint 1.71.0 with --deny-warnings over 14 changed TypeScript files.
- Format: **passed** for six new candidate TypeScript files; existing V1 files retain prior style to avoid unrelated churn (no ADAM formatter configuration was found).
- Patch dry run and application: **passed** on a fresh disposable baseline; all 15 changed/new source files were byte-identical after application.
- No candidate test failures remained. An earlier check against a stale disposable tree failed; reconstructing it from the V1-recorded source hashes resolved that setup issue.

Test environment was Node v24.18.0 and existing dependencies only. The shutdown regression uses an injected synthetic HTTP server/request because the sandbox rejects localhost socket creation; no user endpoint was contacted.

## Limits

This candidate is staged only. Default dispatch remains disabled because trusted decision/custody authorities are absent. It has not been applied to the ADAM checkout or tested against its live database, service, process identity, CLI, sealer, provider, accounts, or transport; independent V2 review and joint Dobius/ADAM integration remain required.
