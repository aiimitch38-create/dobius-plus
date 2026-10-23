# Independent ADAM production composition candidate V2 review

**Verdict: `CHANGES_REQUIRED` for production composition.** The V2 publisher, exact-intent recovery, and internal bounded-drain behavior pass this source review, including the previously missing post-commit lost-ACK case after permanent human-decision revocation. The existing real `service/src/main.ts` callers ignore `AdamService.stop()` returning `false` and terminate anyway; the candidate's safe retained-database result therefore is not honored at the process boundary, so this must be corrected before enabling the feature or treating shutdown as clean.

## Identity and frozen-source verification

- Review task: `task_bb3cd73c557e`; dispatch: `ctx_27fe61f4d61c`.
- Candidate author: `task_d6d018ade0b3` / `ctx_dd6f7dfdc915`.
- Canonical repository/branch: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, `fix/channel-cost`.
- Author receipt: `plans/cloud-workstation-reports-20261012/build2.json#adam-production-composition-candidate-v2-20261015`.
- Author report: `plans/worker-monitor-20261014/BUILD2-adam-production-composition-candidate-v2.md`, SHA-256 `8e883f4f1999d154ec5ceb4fad7fa79a76c7042a61a848585f2cabe91443e26f`.
- Frozen V2 manifest / aggregate: `plans/worker-monitor-20261014/adam-production-composition-candidate-v2/manifest.json`, SHA-256 `7fc192a3c8311f5b2d07b662a7cb506276b445741f15ebba9b82c94254c060d4`.
- Verified 79/79 manifest-listed candidate files by byte count and SHA-256; no symlinks. The 15 changed/new source paths were compared with the actual ADAM read-only baseline: 15/15 matched recorded baseline hashes or were absent as declared.
- Preserved V1 manifest: `31d705aed3d657f9436ed0d065c57625f8a5a1ece9d20466fe88499753a25a98`.
- Base wire contract: `f31b56bec89ac9841afed587eea76e6f5ba085c800f0a26e7760ba60a7e26e6f`; additive lookup contract: `75d3cc984bd37cc2279ddcd3793c08c3b3554812c065250af06bf4b268ffb0ac`.
- Patch: `b7a244744038809a1ba76f9dfa5f2c481c0c5bcbd129e364781c2a6089283bb5`.
- The candidate and actual ADAM `service/src/main.ts` are both unchanged at SHA-256 `58159e34ecb3948a2ce809429b92a7da8a484d5683f27eae2bd556ce8bcad066`.

| Changed/new ADAM path | State | Candidate SHA-256 | Baseline SHA-256 | Bytes |
|---|---|---|---|---:|
| `service/src/db/migrations.ts` | modified | `ab63f722dcad0b5f42720724fa20bafbb86c8341f688cabafb2de8d015fba8e1` | `dfac6a4eb3e6d694468c3b980820559021b2996f54f808d8ab5735444fede3ec` | 23484 |
| `service/src/dobius-cloud/approved-decision-contract.ts` | new | `7686aea2fbf919bf710c980e72baea4a10238db56a3dcb027e0b24c6596ed046` | `absent` | 3115 |
| `service/src/dobius-cloud/approved-decision-operation.ts` | new | `b49e81e5e6206ad2884ee5e11744640efc3138345169df994e403d1f4827ee01` | `absent` | 4120 |
| `service/src/dobius-cloud/approved-decision-publisher.ts` | new | `a338b4d35c035abaccb4e2bb17e30b7dd23faf750df88a92ceaf16f74e8b1ddf` | `absent` | 17204 |
| `service/src/dobius-cloud/approved-decision-store.ts` | new | `a1f2a0590efbace27a5d2d11716c629bd8de037aaf526280aeaa3186754d2c5f` | `absent` | 14371 |
| `service/src/dobius-cloud/approved-job-payload.ts` | modified | `9e5b64b0905e8c8a7e9792468fc0248174a4712a7a2893e46e488a950028d054` | `7b478d364798bb28f2dc5d052ca8e06a60f6b1db28de7913146af4a14c7560a5` | 3688 |
| `service/src/dobius-cloud/child-submit.ts` | modified | `e25ac3504169ddae50422e892113ac8676b9ad577296da2b0aee70622a00d46e` | `c1a5408fba3d5dbed7e7187f0764631586f4afd8301dbe260b22d1adfdf57546` | 4688 |
| `service/src/dobius-cloud/intent-bridge-cli.ts` | new | `d2704e5dbf538e6a137bf39b2aa431b442b050b120e12d9b40c9fd40530d4eac` | `absent` | 15424 |
| `service/src/dobius-cloud/intent-contract.ts` | modified | `c7976e8c6aeb3bf1381461233091a9f23cbf01ed7a428b35d1e5221a20a085b9` | `60d148b77864bb83025e1d8cfeb6f0b3883d3d995759df306fbce165880a7ecd` | 1374 |
| `service/src/dobius-cloud/intent-publication.ts` | modified | `3fc65473281cbf4c9f2581d5ac362e777b36508fbf190e021d17ec14134dfe19` | `8248ffc77766abb62c50303bf51fd5a917652899b480a6b714399ff4a0c25544` | 8768 |
| `service/src/dobius-cloud/receipt-store.ts` | modified | `29f10bb72ae5c8943a7945f59c17fc2270374d29ef320695013a3a72a4b92d92` | `f53ffe295a5b27d01934489cef907cca59e9e4a159019bdfcc932a65a5ed5e2a` | 19516 |
| `service/src/runtime/service.ts` | modified | `efb09c9291bccfefba2c77ca77e837b803f6a30b78de5aad66813311f7547b33` | `251b62dd624918e43c27cdaa37ca02a7e3d21c72162fe92ff681196826504862` | 47967 |
| `service/tests/dobius-cloud-approved-decision-publisher.test.ts` | new | `a83c45f6e1aceaa7b5a0040bb551f04ac6fa6104b67efd5ad183bb0d29e772ba` | `absent` | 20094 |
| `service/tests/dobius-cloud-approved-decision-shutdown.test.ts` | new | `250a6738e2c02e023a364cf70fc8605269fa4fdc4a17cb76d400fe14c1b8c20c` | `absent` | 8654 |
| `service/tests/dobius-cloud-receipt-recovery.test.ts` | modified | `7143d13690ed78b9c3973b4e59b6faee45c73f399bceb4a93a1d57be981e8dda` | `33a29ce749fb7d7dd135bcf29f0678e7228daa58e000cad58fd93fabc847d54e` | 2908 |

## Review findings

### Blocking for production enablement: entrypoint exits despite incomplete drain

`service/src/runtime/service.ts:309-332` now returns a boolean from `stop()`. Its bounded shutdown starts publisher cancellation before HTTP close, drains publisher work, server close, and tracked callbacks, and closes the shared database only when all report drained. On timeout it emits an incomplete-shutdown message, leaves the database open, and returns `false`. The V2 shutdown regression exercises an authenticated synthetic request with a never-settling authority: `service/tests/dobius-cloud-approved-decision-shutdown.test.ts:92-245` observes bounded `false`, forced server close, DB retained, late provider completion inert, and a later sequential `stop()` returning true. That is meaningful internal service coverage.

The real unchanged `service/src/main.ts` does not honor this contract: `--once` and `--prepare-tomorrow` await `stop()` but ignore its result (`:22-36`); SIGTERM/SIGINT handling calls `process.exit(0)` immediately after any result (`:40-46`); and the startup error path swallows stop failure then calls `process.exit(1)` (`:49-53`). The signal path is the material defect: on a `false` drain it reports a successful exit and forcibly tears down the process while the service deliberately retained the DB because callbacks/provider work were unsettled. The candidate's false path is demonstrated reachable through the configured `AdamService` seam in the synthetic shutdown test. It is not currently reachable through the approved-decision feature from the production entrypoint because main constructs `AdamService` without any approved-decision enablement, decision authority, credential authority, executable path, or invoke provider (main `:11-17`; service factory `runtime/service.ts:199-205` fails closed). Therefore this is a definite integration blocker before future feature enablement, not evidence of a presently enabled approved-dispatch route. Other tracked HTTP/startup callbacks also feed the same service drain, so main's unconditional success exit is not limited to the new publisher.

**Required correction before production enablement:** every production caller must inspect the boolean and must not call `process.exit(0)` or return as though shutdown completed when it is false. Define a bounded retry/continued-drain policy that keeps the owning process and database alive until the callbacks are settled, or an explicit terminal-failure policy that proves no future callback can access the DB before exit. Add main-level tests for signal, one-shot, and startup-error paths with a forced false result, including duplicate signals if stop is intended to be idempotent. Current test covers only sequential `stop()` retries and does not test actual entrypoint handling.

### V2 correction confirmed: committed child recovery after permanent decision revocation

`approved-decision-publisher.ts:150-179` reads a durable row first and routes `intent_published === 1` to reconciliation before resolving the current human decision. `reconcileClaimed` loads the exact persisted DTO, validates it against the durable row, and calls authenticated `bridge.lookup` before any fresh decision resolution (`:181-209`). `intent-bridge-cli.ts:201-255` acquires the current service credential, checks its currentness before and after invocation, requires exact runtime/intent/full identity, and validates a returned child against the approved payload. A non-null exact lookup is recorded with the existing decision/intent through lease-token CAS; it does not reseal, renew, submit, mint a new intent, or modify the ADAM parent. A null lookup falls through to fresh exact-decision resolution and refuses if the original decision or intent has expired; current human authority is therefore required for fresh submission, while only current transport/service authorization is required to observe an already committed child.

The new regression at `approved-decision-publisher.test.ts:301-332` does model the crucial side effect ordering: the fake records the consumed binding and child (`:164-165`) before throwing the lost-ACK error (`:166-169`) and permanently sets decision authority false. It advances the clock past expiry, reopens the SQLite database, runs recovery, and verifies unchanged intent ID/expiry, one binding/child, exactly one lookup, no second submit/seal, and no additional decision resolution. The companion absent-lookup test (`:334-349`) keeps the revoked decision and confirms it refuses fresh submission. Credential revocation and wrong-identity cases are separately covered (`:351-389`). This corrects both V1 findings recorded in `RESEARCH-adam-production-composition-candidate-review.md`; it is source/test evidence only, not actual Dobius/ADAM transport proof.

## Boundedness, CAS, and caller composition

- `approved-decision-operation.ts` bounds decision/custody/CLI awaits to a 45-second operation deadline, aborts and generation-fences on stop, and keeps abort-ignoring promises in an unsettled set so the drain remains false until they actually settle. `runtime/service.ts:309-332` uses an overall bounded wait and retains the DB on false. The shutdown fixture demonstrates late authority completion does not invoke the CLI or publish rows.
- The approval store uses an immediate SQLite transaction, a stable intent ID, and lease-token compare-and-set. Published intents remain eligible for lookup when expired; `claim()` only refuses expiry for unpublished intents (`approved-decision-store.ts:114-139`). This permits lookup-only recovery without extending approval or intent lifetime.
- The CLI bridge sends strict request-stdin commands, uses a bounded allowlisted environment and private credential in stdin, and rejects stale credentials or mismatched response identity. Candidate behavior was checked against both frozen wire JSON files; the counterpart is not applied or exercised live.
- The author reports 55/55 focused Node 24 tests, strict NodeNext typecheck, lint, format, and disposable patch checks as passing. I did not rerun suites or execute the CLI; those are author-recorded checks, not independent test runs.
- Current production startup remains default-disabled: the unchanged `service/src/main.ts` provides no approved-decision authorities, and `createApprovedDecisionPublisher` returns `undefined` unless enabled plus all authorities and an executable are supplied. V2 therefore does not establish actual service activation or real startup recovery.

## Scope and limits

Read-only review of the frozen candidate and source baseline; no tests, source changes, database/config/credential reads, service or provider calls, builds, installs, or Git mutations. The synthetic HTTP server is not a real socket test; no live endpoint, credential, sealer, process identity, or installed runtime was verified. Verdict is `CHANGES_REQUIRED` for production composition because the real process entrypoint discards the incomplete-drain result; internal recovery and shutdown source mechanisms otherwise satisfy the reviewed V2 requirements.
