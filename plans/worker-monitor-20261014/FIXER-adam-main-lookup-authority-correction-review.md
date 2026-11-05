# Independent BUILD1 ADAM lookup authority correction review

Task `task_1baf33c791c4`; dispatch `ctx_15ac1fd30bd2`. Coordinator `term_02e778a4-11ae-4292-ba0f-49e2473a2ad9`; runtime `f3546568-4e43-479f-bdf2-f53faba443f1`. Repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`.

## Verdict

**CHANGES_REQUIRED** for one remaining authority fence: lookup does not recheck the dynamic `CloudJobService.authorityAvailable` source after asynchronous unseal. The prior independent-ID and store/project ABA findings are closed in this 26-file freeze, and the earlier admission-clock finding remains closed.

## Freeze and validation

Recomputed all 26 frozen source/test hashes; every file matches `build1.json#adam-main-lookup-authority-correction-20261015`. The sorted path-to-hash map serialized as compact JSON hashes to `161e35a3e607c3016af1fb08dfd18015cd9d5b823436eacf58543128e9ed983c`. The author report hash matches `768bca42651c31590eaf5f3c1ada30266c2a46d60527e626a26b1c907ed673c4`; base wire and recovery addendum hashes also match the required contracts. Full hashes and the exact commands are recorded in `fixer.json#adam-main-lookup-authority-correction-independent-review-20261015`.

I reran the author’s focused test command with explicit Node `v24.18.0` and `--maxWorkers=1`: **13 files / 144 tests passed**. The author’s strict Node and CLI typechecks, scoped lint/format, and diff check are recorded PASS for the verified freeze; I did not rerun those checks.

## Finding

1. **Dynamic service authority can be revoked during unseal without stopping lookup.** `CloudJobService.store` checks `options.authorityAvailable?.() === false` when a store is first obtained (`cloud-job-service.ts`), and the production authority callback re-reads its source configuration and returns false when policy is disabled, invalid, or changed (`cloud-job-authority.ts`). However, `prepareAdamBoundChildLookup()` captures an `active` flag containing only `!closing && !workers.closing`; its reader rechecks store identity/generation plus project snapshot/revision, but never rechecks `authorityAvailable` (`cloud-job-service.ts`, `cloud-job-adam-lookup-authority.ts`). The bridge captures that reader before awaited unseal and its post-await fences check bridge lifecycle, registry proof and reader state, not the dynamic authority callback (`adam-cloud-intent-bridge.ts`). If the authority callback changes from true to false while unseal is pending, while the service/store/project and ADAM proof remain otherwise unchanged, the query can still return the existing child. This violates the required current service-authority fence. Include `authorityAvailable` in the captured/revalidated lookup authority or an equivalent service-owned current-authority check, and add a real temporary-store deferred-unseal regression that toggles the callback false and expects fixed refusal with no DB change.

## Corrections verified

- Stable `intentId` and binding UUID are now independent: the lookup bridge no longer requires equality, passes the stable intent unchanged to method/resource authorization and unseal, and requires the unsealer to return that exact intent plus the full grant identity. The focused integration regression seals, submits and looks up using distinct UUIDs; wrong intent refuses. The canonical request fingerprint and complete binding identity remain checked.
- Store/service/project fencing is now captured before unseal. The reader holds the exact store object and service generation, requires the service to remain active, and captures both canonical project document and monotonic project authority revision. The bridge also rechecks the same CloudJobService object. Fences run before/after unseal, immediately before synchronous lookup, after lookup and before response. Catalog project updates increment the revision even when a later update restores the old document; tested store replacement, service replacement and project ABA mutations refuse.
- Lookup remains a pure observation. Its store path performs SELECT-only binding/job reads, checks binding identity and digest, creator/request key, complete job input and stored fingerprint, and returns only the exact committed child or `null`; mismatches refuse. It does not consume, submit, seal, renew, or write any cloud job, binding, receipt, outbox, event or executor state. Expired exact children remain readable under current service authentication, while the separate fresh-submit admission path uses the catalog’s validated clock for its early check and atomic final gate.
- Current registry proof is checked before unseal, after the await, adjacent to the synchronous query, and before response. Revocation/disposal remain fail-closed. Default startup continues using the unavailable principal registry and Unix transport supplies no ADAM peer proof; no new production provider or enrollment was enabled.

## Limits

All executed tests use synthetic peer/credential/sealer fixtures and temporary SQLite. The source does not prove real OS peer identity, enrollment/custody, an active production revocation source, installed safeStorage support, packaged operation, or live recovery. The separate BUILD2 durable caller remains independently owned; there is no cross-repository or live acceptance claim. No production service, private account/config/profile, device, keychain, or Hermes head was accessed; no source was edited, and no build/install/restart/Git mutation occurred. AWS remains deferred and historical Storage remains paused.
