# Independent ADAM production composition candidate review

**Verdict: `CHANGES_REQUIRED` for bounded source composition.** The candidate is a useful default-disabled foundation: its exact-decision input, sealed-only intent DTO, strict CLI shape, durable SQLite record, and lease CAS are present. Two recovery/lifecycle edges remain before this source can be accepted as a bounded production composition: decision-authority lookup has no deadline and can defeat service shutdown, and recovery after a permanently revoked approval cannot reconcile a child that Dobius already accepted. The existing “lost acknowledgement” fixture does not simulate acceptance before the acknowledgement is lost.

## Review identity and frozen evidence

- Review task: `task_40a039c44372`
- Dispatch: `ctx_f6cb293d8b6b`
- Canonical repository/branch: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, `fix/channel-cost`
- Candidate report: `plans/cloud-workstation-reports-20261012/build2.json#adam-production-composition-candidate-20261015`, SHA-256 `c591d00dbab00bf661e009a720099bc2a8e2a281d29843ce8089af151e7c72cb`
- Candidate brief: `plans/worker-monitor-20261014/BUILD2-adam-production-composition-candidate.md`, SHA-256 `1782b4a54528a1625baf1384b7a987820b4663c1cd688a0ee71d1b4f1333550a`
- Candidate manifest: `plans/worker-monitor-20261014/adam-production-composition-candidate/manifest.json`, SHA-256 `31d705aed3d657f9436ed0d065c57625f8a5a1ece9d20466fe88499753a25a98`
- Candidate patch: `plans/worker-monitor-20261014/adam-production-composition-candidate/patches/adam-production-composition.patch`, SHA-256 `c156625c8c80266195bd4bab45544935c7af77dd061edf74ee74bfe66f304889`
- Fixed wire contract: `plans/worker-monitor-20261014/ROOT-adam-approved-intent-wire-v1.json`, SHA-256 `f31b56bec89ac9841afed587eea76e6f5ba085c800f0a26e7760ba60a7e26e6f`
- Manifest verification: all 76 regular files (74 source/test files plus two support files) matched their recorded byte counts and SHA-256. The 13 changed/new paths also matched the recorded candidate hashes, and their 10 existing paths matched the actual ADAM baseline hashes; three are new. The actual ADAM checkout was read only.

| Changed/new ADAM path | Candidate SHA-256 |
|---|---|
| `service/src/db/migrations.ts` | `ab63f722dcad0b5f42720724fa20bafbb86c8341f688cabafb2de8d015fba8e1` |
| `service/src/dobius-cloud/approved-decision-contract.ts` | `184bd615e8d661064f0dde5c87fd99d16488c6d07808daa78ddfd2a7e02e3f87` |
| `service/src/dobius-cloud/approved-decision-publisher.ts` | `ff782f5d15dc8131077f205e3fa9c20c3dba335fa24b00041109624982a858b4` |
| `service/src/dobius-cloud/approved-decision-store.ts` | `a1f2a0590efbace27a5d2d11716c629bd8de037aaf526280aeaa3186754d2c5f` |
| `service/src/dobius-cloud/approved-job-payload.ts` | `9e5b64b0905e8c8a7e9792468fc0248174a4712a7a2893e46e488a950028d054` |
| `service/src/dobius-cloud/child-submit.ts` | `fd73988c1a457d2fa64fbf47510aa14c7fe3d3f341233153f90e3ec1282809b7` |
| `service/src/dobius-cloud/intent-bridge-cli.ts` | `f87508a9b9e7249ebf114574af27ad756d18a2c1c1bc027a096d203afea9bca7` |
| `service/src/dobius-cloud/intent-contract.ts` | `c7976e8c6aeb3bf1381461233091a9f23cbf01ed7a428b35d1e5221a20a085b9` |
| `service/src/dobius-cloud/intent-publication.ts` | `3fc65473281cbf4c9f2581d5ac362e777b36508fbf190e021d17ec14134dfe19` |
| `service/src/dobius-cloud/receipt-store.ts` | `29f10bb72ae5c8943a7945f59c17fc2270374d29ef320695013a3a72a4b92d92` |
| `service/src/runtime/service.ts` | `75486a1dab4c84775986b587adce3b07062efc8172f37419420a2c06fd4789b4` |
| `service/tests/dobius-cloud-approved-decision-publisher.test.ts` | `bff831b2c68679726e20a0b97078e3eee037a356187acfc547ed7f73c1acbd42` |
| `service/tests/dobius-cloud-receipt-recovery.test.ts` | `7143d13690ed78b9c3973b4e59b6faee45c73f399bceb4a93a1d57be981e8dda` |

## Supported candidate behavior

- `approved-decision-publisher.ts` accepts a UUID decision ID only. Its authority resolves that exact ID to strict canonical JSON; request-body `senderId`, arbitrary approved payloads, and “approve oldest” are not accepted. The publisher persists the full canonical source record, actor/source evidence, authority generation, parent revision/project/context, approved payload digest, original decision expiry, and stable intent ID before side effects.
- `intent-bridge-cli.ts` sends only `seal-adam-intent --request-stdin --json` and `submit-adam-child --request-stdin --json`; capability and service credential are in bounded stdin bodies, not argv. It selects an absolute executable, allowlists environment variables, removes the three declared remote selectors, caps stdin/stdout+stderr, and strictly checks runtime ID, intent ID, binding identity, and child input fields. It returns a bounded child projection rather than raw CLI output.
- Before publication the decision authority is synchronously checked after the awaited seal and again immediately before the receipt store’s atomic binding/intent transaction. Dobius consume checks the exact binding and capability hash, returns an already stored consumed response before expiry, refuses a fresh expired consume, and does not mutate the ADAM parent. The approved-decision store uses SQLite `BEGIN IMMEDIATE`, a stable intent UUID, and lease-token CAS across publisher instances. Recovery uses the existing exact stored DTO; it does not reseal a published intent or renew its expiry.
- These controls depend on constructor-injected trusted decision and credential authorities. The factory returns `undefined` unless enabled and all required dependencies are present, so missing providers fail closed before sealer/CLI calls.

## Findings

### Blocking: decision-source lookup is unbounded and shutdown can hang

`approved-decision-publisher.ts:175-179` awaits `resolveExactDecisionJson()` directly. That interface returns a promise and has no `AbortSignal`, deadline, or timeout wrapper. Startup recovery invokes this path (`runtime/service.ts:251-256`), while the dispatch route waits for startup recovery and later for dispatch (`:321-335`). `AdamService.stop()` waits for `server.close()` before reaching the publisher's 20-second bounded drain (`:260-270`). With an authenticated dispatch request open and an injected decision source that never settles, the handler never finishes, `server.close()` never calls back, and the bounded publisher stop is unreachable. The same non-settling source can also leave startup recovery resident indefinitely.

**Required correction:** give exact-decision resolution a bounded, cancellable operation (late completion must be inert), and make the complete server-stop/recovery-drain sequence deadline-bounded. Keep the DB open if an in-flight callback may still write. Add a fixture with a never-resolving authority, startup recovery plus an open dispatch request, and bounded shutdown assertions; no live service is needed.

### Blocking: permanently revoked authority strands an accepted child after lost acknowledgement

`approved-decision-publisher.ts:114-121` always calls `loadCurrentDecision()` before it examines the persisted child/intent state. After the submit await (`:162`), it calls `assertCurrent()` before `markChildSubmitted()` (`:163-164`). If Dobius has already consumed the exact binding and created the child but the response/authority is revoked before this local commit, the row stays `child_json IS NULL`; the catch releases the lease (`:166-170`). Every restart retry again requires the now-revoked decision authority at `:175-184`, so it cannot return the already-created child or reach the exact consumed replay. A new child is not created, but the accepted child becomes permanently unreconciled. The test named “keeps the published intent retryable when authority revokes during child submission” does not cover permanent revocation: it explicitly calls `setCurrent(true)` before recovery (`approved-decision-publisher.test.ts:194-205`).

**Required correction:** separate fresh submission authorization from reconciliation of a previously published exact intent. Provide a narrow recovery path that can only query/replay the same durable intent and return the authoritative existing child when Dobius confirms the binding was consumed; it must never mint, reseal, renew, or perform a fresh unconsumed submission after expiry/revocation. Keep credential/transport authorization independently current. Add a test where the fake Dobius commits/consumes and creates the child, then drops the ACK while the decision authority is permanently revoked; restart must recover that same child without a second creation or any fresh approval effect. The current test's first-submit throw occurs before its fake bridge records any accepted side effect (`:57-70`), so it is a transport failure, not a post-commit lost ACK.

### Startup and live identity remain intentionally unavailable

The candidate adds `AdamService` options and a route, but the actual unchanged `service/src/main.ts:11-17` (SHA-256 `58159e34ecb3948a2ce809429b92a7da8a484d5683f27eae2bd556ce8bcad066`) constructs `AdamService` without `approvedDecisionDispatchEnabled`, decision authority, credential authority, or a Dobius executable. Consequently the publisher is `undefined`, the route returns 503, and the recovery timer is not started. No production planner/caller for an exact approved decision ID is wired in this candidate. This is the safe default and not evidence of a live bridge; it remains a separate integration prerequisite. Do not enable it by passing a caller-supplied identity, shared-token claim, arbitrary callback, path/hash, or a test provider. The authenticated local service token alone does not establish an ADAM process identity at Dobius.

## Recorded verification and limits

The candidate manifest records 51/51 focused Node 24 tests and a strict NodeNext typecheck as passing, including 12 new composition tests and 39 existing intent/payload/child-submit/receipt tests. I reviewed this recorded evidence only; I did not rerun tests, invoke the CLI, change source, or access live ADAM data/services. The synthetic “lost acknowledgement” case is narrower than its name, as described above. The candidate remains unapplied and default-disabled; source review does not prove real process identity/enrollment, custody/keychain operation, packaged runtime compatibility, installation, or live startup.

Before report completion, the frozen candidate manifest and changed-source hashes were rechecked unchanged. No source files, ADAM files, Git state, services, accounts, credentials, devices, AWS, or historical Storage were modified or accessed beyond the authorized source reads.
