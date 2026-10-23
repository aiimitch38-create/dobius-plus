# Independent BUILD1 ADAM main production-composition review

Task `task_5f3608c866a2`; dispatch `ctx_df21d59f99ed`. Repository `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`.

## Verdict

**CHANGES_REQUIRED** for one bounded admission-clock consistency issue. The reviewed production composition otherwise fails closed by default: startup installs an unavailable service-principal registry, no real transport peer provider is wired, and the recorded default-composition test confirms refusal before the lazy Electron crypto adapter or job store is used. This source result is not installed or live acceptance.

## Freeze verification

Recomputed SHA-256 for the 23 owned source/test files listed in `BUILD1-adam-main-production-composition.md`, that report, and immutable wire `ROOT-adam-approved-intent-wire-v1.json`: **25/25 match** the author packet and `build1.json#adam-main-production-composition-20261015`. The exact per-file values are recorded in `fixer.json#adam-main-production-composition-independent-review-20261015`; the frozen author packet is the source of the 23-path list.

The recorded validation therefore applies to this exact freeze: Node `v24.18.0`, focused Vitest **12 files / 129 tests** with `--maxWorkers=1`, both strict Node 24 typechecks, scoped lint, format check, and `git diff --check` were recorded PASS. I reviewed the recorded evidence and did not rerun tests or alter frozen files.

## Finding

1. **Recovery expiry uses a different clock from the final store write.** In `dobius/src/main/automations/cloud-job-submit-admission.ts:60`, when verified recovery finds no exact child, admission rejects using `Date.now()`. `CloudJobCatalog` accepts an injected `now` clock (`cloud-job-catalog.ts:32-38`), and its final atomic binding writer uses that clock (`cloud-job-catalog.ts:267-272`; `cloud-job-adam-outbox.ts:75-76`). If ambient time is at or beyond expiry while the authoritative catalog clock is still before expiry, a fresh accepted binding with no child is refused early. In the inverse skew, this check may proceed, but the atomic catalog writer still refuses an expired grant, so this finding does not establish an expired-write bypass. Use the store’s authoritative time for this early recovery decision or rely on the final atomic writer; add a deterministic test with offset ambient/store clocks. The default production catalog currently uses `Date.now`, so this is a bounded injected-clock correctness issue rather than a demonstrated default-runtime exploit.

## Reviewed composition

- `index.ts` creates the main bridge through `createDefaultAdamCloudIntentBridge`; the factory supplies `AdamServicePrincipalRegistry.unavailable()`. It uses lazy Electron safeStorage adapters, and runtime shutdown disposes the bridge/sealer lifecycle. The default test demonstrates refusal before crypto or queue effects.
- Peer evidence is taken from `RpcMessageContext`, passed through `runtime-rpc.ts` into dispatcher options, and is not read from RPC params. `UnixSocketTransport` constructs context with only abort signal and keepalive; it does not set ADAM peer evidence. `withTrustedAdapter` is only used by the synthetic test fixture in the reviewed composition. A body field, shared local bearer, local-socket boolean, or caller credential alone therefore does not establish service peer proof; the live default refuses because the registry has no trust adapter.
- The registry hashes credentials and uses `timingSafeEqual` for digest comparison. It checks enrollment/peer/revocation adapter results and revision/generation before issuing or authorizing a proof. The bridge binds proof to service `adam`, exact instance, runtime audience, method, project and resource; it reauthorizes after awaited seal/unseal and in the admission callback. The final callback is adjacent to synchronous exact-child lookup or the atomic store write, so there is no asynchronous gap between that fence and mutation.
- Shared wire schemas are strict and bounded. The bridge detaches identity and approved input before awaits, checks the canonical request fingerprint, and submits only after unsealing the exact sealed identity. Crypto failures are caught and mapped to fixed bridge errors; test adapters/capabilities are synthetic. The code does not establish OS-backed secret protection in this review.
- CLI commands accept only bounded JSON from stdin, use fixed parse errors, suppress remote selection, and call only the sealed RPC names. The legacy plaintext RPC refuses. No real CLI request was issued.
- Recovery is gated by the explicit verified-main callback, uses `findAdamBoundChild` with the original normalized input, binding response, and authenticated creator, and returns the matching row without writes. A mismatch throws and does not fall through; null lookup proceeds only to the atomic binding writer, which validates the exact binding and expiry in its transaction. The recorded temporary SQLite tests cover reopen/lost acknowledgement, unchanged rows on replay, null-lookup submission, expired refusal, mismatch/wrong creator, non-fallback on unavailable transport, principal isolation, and stale project/store checks.

## Limits and remaining proof

The recorded 129 tests exercise source composition with synthetic trust adapters, grants and crypto backends; they do not prove peer enrollment, credential custody, an active revocation source, Electron safeStorage availability, or a real ADAM client. Current startup intentionally cannot accept production ADAM ingress until trusted peer/enrollment providers are wired. BUILD2’s publisher is a separately reviewed source candidate, so these packets do not establish cross-repository end-to-end behavior, packaged-installed readiness, or live exact-child recovery. No live action, source edit, test run, build/install, service/provider/device access, or head action was performed; AWS remains deferred and historical Storage remains paused.
