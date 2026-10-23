# ADAM approved-decision production composition candidate

Task: `task_bec00b4864cc`  
Dispatch: `ctx_da4cc7365d9c`  
Coordinator: ROOT `term_d7866049-2f6c-4300-8625-8ddb23563089`

## Result

Staged a reviewable ADAM service candidate under `plans/worker-monitor-20261014/adam-production-composition-candidate/`. The path starts at `AdamService`, uses the existing SQLite database and receipt store, and accepts only an exact durable decision ID; both the approved-decision authority and per-call Dobius credential authority are constructor-injected and absent by default.

The ADAM `main.ts` still supplies neither authority, so the publisher remains unavailable in the current composition. The candidate does not establish OS/process identity, real decision-source authorization, credential custody, installed Dobius wire support, or live readiness.

## Composition and recovery

- Migration 21 adds a durable decision row bound to exact canonical approved payload/source evidence, parent revision/project/context, authority generation, stable intent ID, and fixed decision/intent expiries. SQLite lease/CAS prevents simultaneous publisher instances from resealing or submitting the same decision.
- The publisher resolves only the requested decision ID through a trusted injected authority, validates canonical JSON and project/fingerprint equality, persists before side effects, rechecks authority after awaits and synchronously before the binding write, and leaves the parent state unchanged.
- If sealing finishes but the binding/intent transaction rolls back, the same row retains only the encrypted envelope, identity, and capability hash. Recovery commits that exact staged material without resealing or extending expiry; plaintext capability exists only in memory for the seal call.
- Submission reads the exact durable DTO `{schemaVersion,intentId,identity,sealedEnvelope,approvedJob}` and calls `submit-adam-child --request-stdin --json`. The service credential goes only through bounded stdin; the CLI executable is absolute, argv contains only the wire command, environment is allowlisted, and remote-selector variables are excluded.
- The internal ADAM route accepts a strict one-field `{decisionId}` request and returns 503 while default-disabled. Startup recovery is serialized, processes one eligible row per 15-second pass, and service shutdown drains bounded work before closing the shared DB.

## Frozen candidate evidence

Candidate manifest SHA-256: `31d705aed3d657f9436ed0d065c57625f8a5a1ece9d20466fe88499753a25a98`  
Unified patch SHA-256: `c156625c8c80266195bd4bab45544935c7af77dd061edf74ee74bfe66f304889`  
Patch check: git apply --check in a disposable /private/tmp baseline tree; PASS; canonical repository index untouched

Changed or new source files (baseline hashes are from the read-only ADAM checkout):

| Candidate path | Baseline SHA-256 | Candidate SHA-256 | State |
|---|---|---|---|
| `src/db/migrations.ts` | `dfac6a4eb3e6d694468c3b980820559021b2996f54f808d8ab5735444fede3ec` | `ab63f722dcad0b5f42720724fa20bafbb86c8341f688cabafb2de8d015fba8e1` | modified |
| `src/dobius-cloud/approved-decision-contract.ts` | `new file` | `184bd615e8d661064f0dde5c87fd99d16488c6d07808daa78ddfd2a7e02e3f87` | new |
| `src/dobius-cloud/approved-decision-publisher.ts` | `new file` | `ff782f5d15dc8131077f205e3fa9c20c3dba335fa24b00041109624982a858b4` | new |
| `src/dobius-cloud/approved-decision-store.ts` | `new file` | `a1f2a0590efbace27a5d2d11716c629bd8de037aaf526280aeaa3186754d2c5f` | new |
| `src/dobius-cloud/approved-job-payload.ts` | `7b478d364798bb28f2dc5d052ca8e06a60f6b1db28de7913146af4a14c7560a5` | `9e5b64b0905e8c8a7e9792468fc0248174a4712a7a2893e46e488a950028d054` | modified |
| `src/dobius-cloud/child-submit.ts` | `c1a5408fba3d5dbed7e7187f0764631586f4afd8301dbe260b22d1adfdf57546` | `fd73988c1a457d2fa64fbf47510aa14c7fe3d3f341233153f90e3ec1282809b7` | modified |
| `src/dobius-cloud/intent-bridge-cli.ts` | `new file` | `f87508a9b9e7249ebf114574af27ad756d18a2c1c1bc027a096d203afea9bca7` | new |
| `src/dobius-cloud/intent-contract.ts` | `60d148b77864bb83025e1d8cfeb6f0b3883d3d995759df306fbce165880a7ecd` | `c7976e8c6aeb3bf1381461233091a9f23cbf01ed7a428b35d1e5221a20a085b9` | modified |
| `src/dobius-cloud/intent-publication.ts` | `8248ffc77766abb62c50303bf51fd5a917652899b480a6b714399ff4a0c25544` | `3fc65473281cbf4c9f2581d5ac362e777b36508fbf190e021d17ec14134dfe19` | modified |
| `src/dobius-cloud/receipt-store.ts` | `f53ffe295a5b27d01934489cef907cca59e9e4a159019bdfcc932a65a5ed5e2a` | `29f10bb72ae5c8943a7945f59c17fc2270374d29ef320695013a3a72a4b92d92` | modified |
| `src/runtime/service.ts` | `251b62dd624918e43c27cdaa37ca02a7e3d21c72162fe92ff681196826504862` | `75486a1dab4c84775986b587adce3b07062efc8172f37419420a2c06fd4789b4` | modified |
| `tests/dobius-cloud-approved-decision-publisher.test.ts` | `new file` | `bff831b2c68679726e20a0b97078e3eee037a356187acfc547ed7f73c1acbd42` | new |
| `tests/dobius-cloud-receipt-recovery.test.ts` | `33a29ce749fb7d7dd135bcf29f0678e7228daa58e000cad58fd93fabc847d54e` | `7143d13690ed78b9c3973b4e59b6faee45c73f399bceb4a93a1d57be981e8dda` | modified |

## Verification

- Node `v24.18.0`: **51/51** focused cloud-intent, payload, child-submit, receipt-recovery, receipt, and production-composition tests passed. This includes the preexisting focused suites and 12 new composition tests for default-off/absent authority, exact decision source, project binding, durable retry after SQLite reopen, staged-seal rollback recovery, expiry stability, revocation before publication and during submission, wrong runtime/child response refusal, same-process coalescing, and cross-instance lease CAS.
- Strict NodeNext TypeScript check: **PASS** over the candidate `runtime/service.ts`, composition test and receipt-recovery migration test, recursively typechecking their imported candidate modules.
- Candidate patch dry-run against copied baseline files: **PASS**. No canonical Git index or actual ADAM source was changed.
- No separate ADAM formatter/linter executable was available in the existing dependency tree; no install was performed.

Exact test and typecheck commands are stored in the candidate `manifest.json`.

## Limits and next gate

This is source candidate evidence only. BUILD1 owns the corresponding Dobius main/CLI/shared implementation and must finish the exact immutable wire-contract composition and tests. A real approved-decision provider, independent ADAM caller/process proof, protected credential custody, durable enrollment/revocation, and supported packaged runtime remain unavailable; no provider or service was activated here. ROOT must review and apply the patch to the authorized ADAM checkout separately before any build or live acceptance.
