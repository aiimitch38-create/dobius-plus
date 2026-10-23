# Independent BUILD1 ADAM lookup-only recovery review

Task `task_dbc825623b16`; dispatch `ctx_0e4e52e72d02`. Repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`.

## Verdict

**CHANGES_REQUIRED** for two lookup contract/fencing gaps. The prior admission clock finding is closed: admission reads `store.currentTimeMs()`, which validates the same injected clock used by the atomic binding writer, and the recorded offset-clock regression exercises that behavior. The lookup path is read-only for matching source, but it does not yet meet the stated intent-ID compatibility and store/project drift requirements.

## Freeze and recorded checks

Recomputed SHA-256 for all **27** packet inputs: 24 owned source/test paths, the BUILD1 report, and the base and additive recovery wire contracts. All match the exact values in `build1.json#adam-main-recovery-composition-20261015`; the full path/hash map and aggregate are in `fixer.json#adam-main-recovery-composition-independent-review-20261015`.

The packet’s recorded evidence matches this freeze: Node `v24.18.0`; **13 files / 140 focused tests** with `--maxWorkers=1`; Node and CLI strict typechecks, scoped lint/format, and `git diff --check` recorded PASS. I reviewed the recorded results and source; I did not rerun tests or modify frozen files.

## Findings

1. **Lookup imposes an undocumented equality between stable intent ID and binding ID.** `adam-cloud-intent-bridge.ts:158-163` rejects unless `request.intentId === identity.bindingId`. The additive wire contract defines these as separate fields (“stable intent” and full binding identity) and does not require equality; the base envelope schema likewise has separate UUID fields and the seal/submit bridge does not enforce equality. A valid sealed/submitted intent with distinct stable `intentId` and `bindingId` can therefore be accepted for submit but can never be recovered through lookup. Current lookup fixtures set `bindingId: intentId` (`adam-cloud-child-test-fixtures.ts:31`), so the recorded suite does not exercise this case. Remove the implicit equality or make it an explicit shared base/addendum contract enforced consistently at seal and submit, with a regression using distinct valid IDs.

2. **Lookup does not fence store/project drift across awaited unseal.** `lookup()` awaits unseal at `adam-cloud-intent-bridge.ts:177-182`, then obtains the service at line 191 and enters lookup at lines 195-202. `CloudJobService.lookupAdamBoundChildForVerifiedAdam()` (`cloud-job-service.ts:289-291`) passes the current `this.store.db` to a helper whose callback only rechecks bridge liveness and registry proof; the helper (`cloud-job-adam-child-lookup.ts:125-136`) has no service/store generation or current-project snapshot check. Thus if the cloudJobs service/store or registered project is replaced/updated while unseal is pending, a still-valid service proof can query the replacement/current store and return its matching child or `null`, instead of refusing the drift as required. The existing revocation/disposal races are covered, but the lookup tests do not mutate/reopen the store or update the project during unseal. Capture and synchronously revalidate the exact service/store/project authority across the await before querying, and add temporary-store regressions for replacement and project mutation; keep the final check adjacent to the read and response.

## Verified bounded behavior

The lookup request uses the strict submit packet schema and 131072-byte CLI stdin limit. It verifies the separately enrolled lookup method, request credential, transport peer, runtime audience, instance, project, intent resource and current registry generation before unseal; it repeats proof/lifecycle checks after await, immediately before the synchronous query and before response. Caller RPC body, shared bearer and paired/local flags do not supply peer evidence, and production startup remains wired to the unavailable registry.

The verified-grant store query only performs reads. It checks input fingerprint, binding identity and digest, creator, request key, full job input and stored job fingerprint; a persisted mismatch throws, while no binding/job returns `null` only when there is no conflicting planner request row. It does not consume ADAM state, submit, publish, reseal, renew expiry, or write job/binding/receipt/outbox/event/executor state. The real temporary SQLite tests compare snapshots and spy on consume/submit. Expired original bindings may return an exact existing child; absent expired work is not newly authorized by this lookup. Admission’s separate submission path now uses the validated catalog clock for expiry and still relies on the atomic writer’s final expiry check.

## Limits

The default production registry remains unavailable and the current Unix transport supplies no ADAM peer evidence, so this ingress remains disabled in the live default composition. Test trust adapters, credentials, grants and ciphertext are synthetic; no OS peer identity, enrollment/custody, real revocation source, or Electron safeStorage readiness is proven. BUILD2’s ADAM durable caller is a separately owned candidate; this review establishes neither cross-repository integration nor packaged/live recovery. No live action, tests, source edit, build/install, or service/device/head action was performed; AWS remains deferred and historical Storage remains paused.
