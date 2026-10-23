# ADAM service-principal registry foundation

Date: 2026-10-14  
Task/dispatch: `task_6272605624be` / `ctx_b1f821038539`  
Repository: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`  
Branch: `fix/channel-cost`  
Status: **BOUNDED_INTERNAL_SOURCE_FOUNDATION; production unavailable**

## Scope and API

Added only:

- `dobius/src/main/adam-service-principal/registry.ts`
- `dobius/src/main/adam-service-principal/principal-contract.ts`
- `dobius/src/main/adam-service-principal/registry.test.ts`
- this source contract and the BUILD1 `build1.json` receipt entry.

The `AdamServicePrincipalRegistry` API has three operations:

- `enroll(raw, enrollmentProof)` strictly parses a bounded identity and a canonical 32-byte base64url credential, detaches the identity, hashes the credential with SHA-256, and asks the trusted enrollment adapter to verify the identity plus credential digest. It holds only the digest in memory, never returns the credential, and requires a strictly newer authorization generation for re-enrollment.
- `verify({peer, credential, request})` asks the trusted adapter to verify the actual transport peer, then checks the verified service/instance/audience/generation tuple, constant-time credential digest, audience, method, project, and exact method-project-resource grant. It returns a frozen detached proof tracked in a private `WeakMap`; copying or structurally fabricating the proof does not authenticate.
- `authorize(proof, request)` synchronously rechecks the private proof record against the current registry entry and repeats exact scope validation. A revoked or replaced generation fails closed. `revoke(serviceId, generation, proof)` requires adapter approval and fences the awaited approval against concurrent registry mutation.

`AdamServicePrincipalRegistry.unavailable()` has no enrollment or peer authority and refuses every operation. `withTrustedAdapter(...)` is an internal main-composition seam; injected callbacks and test fixtures are not caller credentials or OS/process identity. No export was added to renderer, preload, RPC, CLI, HTTP, or ADAM. Existing cloud-job unsealer and RPC method were not changed or wired.

The enrollment adapter must be created only by trusted main composition. Its `verifyEnrollment` implementation must prove an authorized operator enrollment and that the provided digest is bound to a cryptographically unpredictable 256-bit credential issued outside this module; its `verifyTransportPeer` must derive the peer principal from a real platform-authenticated connection, never request fields; its `verifyRevocation` must verify the revocation authority. The module checks canonical encoding/length and constant-time digest equality but cannot prove token entropy or OS identity. Until such a real adapter exists, production construction must remain `unavailable()`.

The registry is memory-only. It neither generates a production secret nor persists raw credentials, digest rows, enrollment state, or revocation state. Process restart therefore drops enrollment and intentionally returns to unavailable. A future production implementation needs reviewed durable enrollment/verifier storage, credential provisioning/rotation, OS-authenticated local transport, remote-principal policy where applicable, lifecycle ownership and restart/revocation integration before any caller can use it. A same-user runtime bearer, paired mobile token, caller-provided principal string, or object-shaped proof is insufficient.

## Regression coverage and verification

The 16 deterministic tests use synthetic credentials and injected adapters only. They cover unavailable default; scope success and detached immutable proof; raw-claim forgery; credential/canonical-byte failure; wrong audience, method, project, resource and method-resource combination; strict sorted/canonical enrollment; mutation during async enrollment; stale proof after generation replacement; revocation and stale-generation refusal; async transport verification racing revocation; and fixed redacted failures for accessors, proxies and throwing adapters, with malformed inputs refused before adapter calls.

Counted line totals are 163 (`principal-contract.ts`), 185 (`registry.ts`), and 277 (`registry.test.ts`), each below the 300-line limit.

Commands, run from `dobius/`:

```text
/Users/bayou/homebrew/opt/node@24/bin/node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/main/adam-service-principal/registry.test.ts --maxWorkers=1
PASS: 1 file, 16 tests; mocked trusted-adapter fixtures and synthetic credential only.

/Users/bayou/homebrew/opt/node@24/bin/node node_modules/typescript/bin/tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2022 --module ESNext --moduleResolution Bundler --types node,vitest/globals --skipLibCheck src/main/adam-service-principal/principal-contract.ts src/main/adam-service-principal/registry.ts src/main/adam-service-principal/registry.test.ts
PASS exit 0.

/Users/bayou/homebrew/opt/node@24/bin/node node_modules/oxlint/bin/oxlint src/main/adam-service-principal/principal-contract.ts src/main/adam-service-principal/registry.ts src/main/adam-service-principal/registry.test.ts
PASS exit 0.

/Users/bayou/homebrew/opt/node@24/bin/node node_modules/oxfmt/bin/oxfmt --check src/main/adam-service-principal/principal-contract.ts src/main/adam-service-principal/registry.ts src/main/adam-service-principal/registry.test.ts
PASS exit 0.
```

These checks do not prove a trusted platform adapter, secret entropy, durable registry, process identity, authenticated bridge, unseal/submit authorization, packaged behavior, or live readiness. No actual credential was generated or persisted; no network, OS-authentication, safeStorage, private configuration/account, ADAM service, app, or head-agent operation was performed. No package, dependency, existing crypto source, RPC, renderer, or ADAM checkout was changed.
