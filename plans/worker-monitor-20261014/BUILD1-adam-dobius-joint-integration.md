# BUILD1 ADAM–Dobius joint synthetic integration

Task `task_d0a255e2f646`, dispatch `ctx_a5ff3ffc2d3f`; supervised by ROOT `term_2958d5fd-ff36-4ae7-9f23-6ed32a748f54` in runtime `6627a505-a9ea-4b59-90e7-d051eb153516`. Repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`.

**Verdict: `PASS_JOINT_SYNTHETIC_SOURCE_INTEROP`.** The frozen V4 ADAM approved-decision publisher and CLI request-stdin adapter interoperated with the reviewed Dobius main bridge, service, store, registry verifier, RPC method handlers, and the actual ADAM binding-consumption store path. No defect was reproduced in this bounded composition.

## Exact input freezes

- Dobius main source: all 26 paths in `build1.json#adam-main-dynamic-authority-correction-20261015` re-hashed without mismatch; aggregate `d0bde5b35d036aa6cbcb69d85a13d7482f09baa6de8385f43a728c17bd1deddd`. The accepted dynamic-authority source review receipt is `plans/worker-monitor-20261014/ROOT-fixer-dynamic-authority-review-reconciliation-20261015.json`, SHA-256 `b59821ee55e8c16c01f0c756a72845ebde2540c4a98109f24ab7083e04dc05df` (148 independent source tests; source-only).
- ADAM V4 candidate manifest: `plans/worker-monitor-20261014/adam-production-composition-candidate-v4/manifest.json`, SHA-256 `ddb8bc73f8521af2563cf32cf1d67c1ae20c77fc3db7e65dfe7b22b24d38a96e`; all 81 manifest source files matched their recorded hashes. The accepted V4 review receipt is `plans/worker-monitor-20261014/ROOT-research-production-v4-reconciliation-20261016.json`, SHA-256 `194934d0d91c9149b7253fb74aaf9c0234984d7a347ba9982fb9b97a9235724d` (70 independent source tests; source-only).
- Both are the exact gates named by the active dispatch; V4 supersedes the rejected V3 gate. The ADAM candidate remains unapplied.

## Harness and execution

The harness adds only these files:

- `plans/worker-monitor-20261014/joint-integration/run.mjs` — SHA-256 `de13e643df0281eba5c6bfae80e50972a02a6895263475984d4167e9b42186e7`.
- `plans/worker-monitor-20261014/joint-integration/joint-integration.test.mjs` — SHA-256 `c1630d06b5c6369edab0a5d3e04c18bada6d895dadd691c1b6e60ce9e30850f8`.
- `plans/worker-monitor-20261014/joint-integration/README.md` — SHA-256 `04ff0541a641e85ba34e3b3a7032c4dbabde300c9849bb9a1784ecb0fb88e963`.

The runner bundles the real frozen modules from explicit roots with the existing Dobius `esbuild`, runs Node's test runner under Node 24, and deletes the temporary bundle. Each scenario uses separate temporary ADAM and Dobius SQLite databases. The adapter parses the actual V4 CLI's stdin JSON and passes the request to the actual `ADAM_CLOUD_CHILD_METHODS` handler; it does not launch the CLI or connect to a live RPC transport.

Command:

```sh
/Users/bayou/homebrew/opt/node@24/bin/node plans/worker-monitor-20261014/joint-integration/run.mjs \
  --repo '/Users/bayou/Projects (Code)/Dobius/dobius-plus' \
  --adam-service '/Users/bayou/Projects (Code)/Dobius/dobius-plus/plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service'
```

Result: **PASS, 9 tests, 0 failures, 0 skips**, Node `v24.18.0`. Scoped `oxlint` passed on both `.mjs` files; scoped `oxfmt --check` passed on all three harness files; a scoped trailing-whitespace scan was clean. The prior accepted source suites were not rerun because the harness did not change source.

## Composed evidence

The end-to-end case creates an authorized decision with the actual ADAM `JobStore` and `ApprovedDecisionStore`, publishes through `ApprovedDecisionPublisher` and its actual `DobiusApprovedIntentCli`, enrolls a synthetic peer with the actual Dobius in-memory registry, and dispatches through the actual main RPC handler and `AdamCloudIntentBridge`. `CloudJobService` and `CloudJobStore` write the child and binding; the trusted fixture client invokes the actual ADAM `DobiusCloudReceiptStore.consume` implementation.

Two independent publisher instances race the same decision. Exactly one synthetic seal, submit and binding consume occur. The Dobius child and binding are committed before the fixture drops the submit reply; the human decision authority is then revoked. After stopping the first publishers, closing and reopening the ADAM SQLite database, and advancing time beyond the persisted intent expiry, the new publisher recovers through actual read-only lookup. It returns the exact same child from the same Dobius store object, with action totals still at one seal, one submit, one consume and one lookup; no new intent or binding is issued, and the intent expiry is unchanged. The generated intent UUID and binding UUID are explicitly distinct in this scenario. The ADAM parent remains `received` throughout.

The null-lookup case drops the initial submit before the main handler, then revokes human approval and advances past expiry. Recovery performs lookup, receives no child, and refuses before a second submit, seal, consume, intent, or expiry extension. Additional cases verify refusal for changed runtime audience, project, approved payload, full binding identity and CLI response identity. Two deferred-unseal races revoke the service-principal generation or disable cloud authority after proof verification; both refuse before child creation or binding consumption, keep the committed ADAM receipt state unchanged, and do not reveal the synthetic capability in the returned error.

## Boundary and remaining gates

This is a source-level synthetic interop result only. Registry enrollment and transport peer evidence use fixture callbacks and a synthetic peer; the resource scope is seeded from the actual persisted intent ID so the test can exercise the registry's exact-resource check. Seal/unseal uses a fixture-only in-memory token map, not Electron `safeStorage`, OS custody, or authenticated decryption. The harness invokes actual method handlers directly and does not prove the production CLI/RPC socket, application startup wiring, real enrollment or process authentication. No live ADAM checkout, user database, account, provider, keychain, device, application, or service was accessed or changed; no production source was applied or activated.

The production registry and bridge therefore remain unavailable without real main-owned enrollment and authenticated transport composition. Production-safe generation/resource enrollment, OS-backed sealing/unsealing, live process authorization, the V4 source application, packaging, and live operation remain separate gates. AWS is deferred and the historical Storage queue remains paused.

## Coordinator delivery

The single `worker_done` attempt for task `task_d0a255e2f646` / dispatch `ctx_a5ff3ffc2d3f`, sent from worker handle `term_7127bcf7-89b5-4a5b-9c99-9b185d6662cc`, failed because the Dobius app is unavailable in this sandbox. No restart or retry was made; this saved report and its `build1.json` receipt are the completion fallback.
