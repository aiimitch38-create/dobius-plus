# Independent review: ADAM service-principal registry

Task/dispatch: `task_53202f4b2b63` / `ctx_62d46313c08c`  
Repository/branch: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, `fix/channel-cost`  
Verdict: **PASS_BOUNDED_SOURCE**  
Scope: read-only review of the exact three-file BUILD1 source packet. No source edits, tests, builds, keychain/OS authentication, service/account/profile access, or runtime calls were made.

## Freeze verification

The three implementation/test files match the author’s exact frozen per-file SHA-256 values in `build1.json#adam-service-principal-registry-source-resume-20261014`. Deterministic aggregate below is SHA-256 of the UTF-8 concatenation of sorted `path + one space + lowercase file SHA-256 + newline` rows:

| File | SHA-256 |
|---|---|
| `dobius/src/main/adam-service-principal/principal-contract.ts` | `02e49314b603e60a5dcd44a27ac1481e832180fd42bece867afd76f8875995c5` |
| `dobius/src/main/adam-service-principal/registry.ts` | `5ed3004c6cb5604e7d4a2c3a6a3f4c384d75603e47f7d4bf4fee91dcb02d765f` |
| `dobius/src/main/adam-service-principal/registry.test.ts` | `a5a80ebea1a5e25aa6ee537aae77e881a5fcb937d6ec83fc5ec6e6736e52d169` |

Aggregate (`path sha256\n`, sorted): `8e50a6f4d99734d054ea984b4b9d3e9edfe608cc167a7092e150be5c64a7a78f`.

Supporting evidence hashes: author contract `plans/worker-monitor-20261014/BUILD1-adam-service-principal-registry-source.md` = `53f884438a922446a2355bc34f8b95e888eb225a1a93a5ebe1c6e7160a4ddb2f`; report receipt `plans/cloud-workstation-reports-20261012/build1.json` = `16620c188339feea103cb2a55108c969091a1995dee01b8e705e45083e020eee`.

## Review findings

The bounded source foundation is internally coherent and fail-closed:

- `principal-contract.ts:4-79` uses strict object schemas, bounded identifiers/collections, canonical lower-case UUIDs, positive safe-integer generations, sorted unique allowlists, and a canonical 32-byte base64url credential representation. `assertAllowed` at lines 142-162 requires the exact audience, method, project, and method/project/resource tuple; a matching method or project alone is insufficient.
- `registry.ts:41-57` defaults to an unavailable registry without an adapter. No service identity is accepted merely because a request claims it. `verify` at lines 89-124 requires a credential digest match and a peer identity returned by the trusted adapter, then issues a frozen proof tracked by a registry-private `WeakMap`. Structural copies do not authenticate.
- Enrollment detaches/freeze-copies parsed identity before awaiting the adapter (`registry.ts:59-86`). Mutation revision checks after each awaited trust operation fence concurrent enrollment/revocation (`registry.ts:68-76, 99-105, 147-175`). Per-service `lastGeneration` rejects equal or older re-enrollment even after revoke. `authorize` is synchronous and rechecks the live entry/generation and exact requested scope (`registry.ts:126-145`), so the protected caller can place it immediately before its no-await effect.
- Credentials are decoded canonically, reduced to an in-memory SHA-256 digest, and compared with `timingSafeEqual` for equal-length digests (`principal-contract.ts:105-110, 138-140`; registry enrollment/verify at `registry.ts:64-70, 94-112`). Public failures collapse to a fixed error; parse, accessor/proxy, and adapter exceptions are caught without returning exception text (`registry.ts:59-86, 89-124, 147-175`). The registry does not persist or return the credential.
- The test packet exercises unavailable default, forged raw claims rejected by its adapter, wrong credential and scope, malformed/canonical input, detached enrollment input, stale generation/proof, revocation racing peer verification, copied proof, proxy/accessor failures, and redacted adapter exceptions. The author’s report records 16 tests plus focused strict TypeScript, oxlint, and oxfmt checks passing; these were not rerun for this review.
- A bounded source search found no consumer of `AdamServicePrincipalRegistry` outside its own new module/tests. This is not yet a production principal or authorization path.

### Required before privileged integration

The `verify` contract still accepts `{ peer: unknown }` as part of the raw verification input (`principal-contract.ts:73-79`) and passes it to `trust.verifyTransportPeer(peer)` (`registry.ts:89-105`). The registry checks only what the adapter returns; therefore the adapter must not interpret an HTTP/RPC/body `peer` claim as identity. The production seam must be narrowed so main composition supplies an opaque, main-created context for the actual authenticated connection (or the adapter closes over the exact accepted connection); it must not accept caller-supplied identity fields or a generic local runtime bearer as proof. Add a regression proving an untrusted request cannot choose or replace that context. Until this exists, only the unavailable/default instance is safe for production; injected test adapters prove registry behavior, not OS/service-process authentication.

The other documented prerequisites are genuine and remain open: no trusted enrollment/OS or remote transport adapter; no CSPRNG credential issuer; no durable verifier, enrollment, generation, or revocation store; no restart/lifecycle binding; no ADAM caller or privileged RPC/unseal/submit integration. A process restart loses this in-memory registry by design. Enrollment adapter must bind the exact digest to approved identity and unpredictable credential; platform peer authentication and revocation-generation checks must be independently reviewed. Any privileged caller must synchronously call `authorize` immediately before the protected effect and perform no intervening `await`.

The identifier grammar is bounded and restricted to ASCII identifier characters but preserves case (`principal-contract.ts:4-8`). This is safe for exact, case-sensitive opaque identifiers; the upstream issuer must define and use one canonical spelling if service/project IDs are case-insensitive. Do not normalize after enrollment or broaden identifiers without a compatibility contract.

## Smallest next implementation slice

1. Add an unforgeable main-owned authenticated-connection context type, produced only by the transport accept/authentication layer, and change verification to accept that context separately from request data. `verifyTransportPeer` must consume that context and return the verified service/instance/audience/generation tuple. Test forged body peer, wrong connection, wrong instance, stale generation, disconnect/reconnect, and revocation during async verification using synthetic transport fixtures.
2. Keep the registry unavailable unless the production adapter is fully constructed; add OS-authenticated local enrollment/peer fixtures per platform and a remote authenticated-peer fixture before wiring any method. Do not equate socket path, process path/hash, caller label, or bearer possession with ADAM process identity.
3. Add a bounded durable enrollment/verifier-generation store and explicit credential issuance/rotation/revocation transaction, then test restart, rollback, duplicate generation, replacement, and revocation. Do not persist plaintext credentials. Keep the synchronous `authorize` immediately before each protected no-await action.
4. Only after those reviews, wire the narrow main-only service principal to individual methods with exact method/project/resource scope and audit each effect. Do not expose the registry, credential, proof, or generic unseal scope to renderer/mobile/ordinary RPC callers.

## Validation and limits

Review commands were read-only hash/source inspection and bounded `rg` source search; no new tests or checks were run. The author receipt records the focused command/results, but they cover synthetic injected adapters only. No actual ADAM process, OS peer credential, service enrollment, credential generation, durable registry, keychain/safeStorage, RPC integration, packaged app, or live authorization was verified. `PASS_BOUNDED_SOURCE` is not production authentication or deployment acceptance.
