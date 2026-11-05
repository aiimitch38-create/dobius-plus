# Independent BUILD1 ADAM dynamic-authority correction review

Task `task_4050055d577b`; dispatch `ctx_4eeb2a9a49ae`. Coordinator `term_02e778a4-11ae-4292-ba0f-49e2473a2ad9`; runtime `f3546568-4e43-479f-bdf2-f53faba443f1`. Repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`.

## Verdict

**PASS — bounded source review.** The previously reported dynamic cloud-authority gap is closed in the exact 26-file freeze. I found no remaining source issue in the requested dynamic authority, read-only lookup, distinct-ID, project/store, clock, or retained proof/lifecycle checks.

## Freeze and verification

Recomputed all 26 source/test SHA-256 values and the sorted compact-JSON aggregate `d0bde5b35d036aa6cbcb69d85a13d7482f09baa6de8385f43a728c17bd1deddd`; all match `build1.json#adam-main-dynamic-authority-correction-20261015`. The author report hash is `2955c8adfd34ef20a5e2aaec5ac31a679a8bf9dbd57cacf1cc70d3aae8db32df`; both immutable base and recovery wire hashes match. Exact values are frozen in `fixer.json#adam-main-dynamic-authority-correction-independent-review-20261015`.

I independently reran the complete focused Node `v24.18.0` command from the author report with `--maxWorkers=1`: **13 files / 148 tests passed**. The author’s strict Node/CLI typechecks, scoped lint and format checks, and `git diff --check` are recorded PASS for these matching hashes; I did not rerun them.

## Review findings

No changes required in the reviewed source slice.

- `CloudJobService.prepareAdamBoundChildLookup()` captures the store, service generation, project snapshot and monotonic project revision. Its current-state reader now includes `options.authorityAvailable?.() !== false`, in addition to store identity/generation and service liveness. Absence of the optional callback remains permissive under the existing optional-service contract; `false` refuses and a thrown callback propagates to the bridge’s fixed redacted refusal.
- `AdamCloudIntentBridge.lookup()` captures service and reader before awaiting unseal. It rechecks current registry proof, bridge lifecycle, current service identity, store/generation/liveness, project snapshot/revision, and dynamic service authority before and after unseal, at the synchronous read boundary, and after the read before creating the response. There is no await between the final read/currentness checks and reply construction.
- The new temporary-SQLite regressions cover authority toggled false and callback exception during deferred unseal, initially unavailable authority before unseal, and a callback that turns false at final currentness verification. They require the fixed bridge refusal and compare project/job/binding/event/outbox rows; no consume or submit occurs. This exercises initial, post-await and final checks under valid synthetic service proof while the same store/project remain in place.
- Independent `intentId` and binding UUID handling remains compatible with the wire: distinct IDs seal, submit and recover; wrong intent refuses. The full identity and request fingerprint remain bound.
- Store/service replacement and project mutation including update-then-restore still refuse. The project revision increments through the catalog registration path, so restoring the same serialized project document does not restore the captured revision.
- Lookup remains a pure read of the exact existing child and persisted consumed binding. It does not consume, submit, seal, renew expiry, or write job, binding, receipt, outbox, event or executor state. Expired exact children may be observed under current service authentication; a lookup miss itself cannot submit. The separate admission path uses the validated catalog clock and retains its atomic final expiry gate.
- Existing service-proof, credential, transport-peer, revocation and disposal fences remain in place. Production composition still uses an unavailable registry, and the Unix transport does not populate ADAM peer evidence; the correction enables no production provider or enrollment.

## Limits

This PASS applies only to the frozen Dobius source and synthetic regression evidence. Tests use temporary SQLite and synthetic peer, credential, grant, crypto and authority callbacks; they do not prove operating-system peer identity, production enrollment/custody, a live revocation source, Electron safeStorage readiness, packaged installation, a real ADAM caller, or live recovery. BUILD2 remains separately owned, so no cross-repository acceptance is claimed. No source files, candidates, production config, accounts, devices, keys, services or Hermes heads were changed or accessed. AWS remains deferred and historical Storage remains paused.
