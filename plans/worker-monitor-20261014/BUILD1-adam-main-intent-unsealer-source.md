# BUILD1: internal ADAM intent recovery unsealer

**Task / dispatch:** `task_43f9388a61f5` / `ctx_e0eb2db369ec`  
**Repository / branch:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, `fix/channel-cost`  
**Status:** internal main-process decrypt half only; no caller, route, lifecycle wiring, or activation.

## Source contract

`cloud-job-adam-intent-unsealer.ts` lazily binds Electron main `app` and `safeStorage`; it performs no secret-store operation at module import or factory construction. Its internal-only `unseal(unknown)` accepts the strict v1 intent ID, full shared `CloudJobAdamBindingIdentity`, and the existing `sealed:dobius-adam-intent:v1:` envelope. It enforces the 64 KiB encoded limit, exact prefix, standard canonical base64, and nonempty ciphertext before asking the backend to decrypt.

The unsealer uses the common `cloud-job-adam-intent-protocol.ts` and `cloud-job-adam-intent-runtime.ts`, also adopted by the existing sealer. These centralize the ADAM purpose/version/schema and the stable Electron >=42.4.1, app-ready, async-availability, Linux libsecret/KWallet allowlist, runtime snapshot, and lifecycle-generation checks. Both operations recheck runtime identity and operation API around each await; invalidate/dispose fence pending and future calls. Sealing's prior 19 regressions still pass after this extraction.

The decrypt result is strictly parsed as `{result:string, shouldReEncrypt:boolean}`. `shouldReEncrypt === true` refuses without rewriting or resealing. Plaintext UTF-8 bytes are bounded before JSON parsing; the decoded purpose and schema must match, intent ID must equal the request, every immutable identity scalar must match exactly, and capability remains 32–512 characters. The returned frozen internal value contains only `{intentId, grant}` using the shared full grant schema; expiry is preserved exactly, including an already-expired identity, and is neither renewed nor used here to authorize a new submission. Raw input, property-accessor/proxy failures, API result failures, parser errors, and backend exceptions map to one fixed public error.

## Verification

Node 24.18.0 focused Vitest passed **54 tests** across the retained sealer suite and new unsealer suite with `--maxWorkers=1`. Strict explicit-file TypeScript, scoped oxlint, and oxfmt `--check` passed. The exact commands, paths, hashes, and source/test aggregate are recorded in `build1.json:adam-main-intent-unsealer-source-20261014`.

All fixtures use synthetic grants, ciphertext, and injected runtime objects. No real Electron safeStorage API, keychain, platform backend, app, ADAM service, database, or production runtime was called. This does not provide an authenticated caller bridge, ADAM service authorization, main lifecycle composition, database/recovery caller, re-encryption flow, package upgrade, OS-protection proof, packaged acceptance, or live recovery. Current installed Electron 42.3.3 remains below the minimum, so the production factory continues to refuse until ROOT separately handles the dependency and acceptance gates.
