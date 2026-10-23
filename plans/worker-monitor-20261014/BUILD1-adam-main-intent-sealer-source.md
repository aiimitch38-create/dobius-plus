# BUILD1: ADAM main-process intent seal adapter

**Task / dispatch:** `task_e356060bf93b` / `ctx_fd6aa8eee700`
**Repository / branch:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, `fix/channel-cost`
**Status:** bounded seal-only source implementation; no service bridge or production caller.

`cloud-job-adam-intent-sealer.ts` validates the exact ADAM v1 intent envelope against the shared `CloudJobAdamBindingIdentity`, detaches and freezes its scalar identity, then encrypts a purpose-tagged full envelope through Electron's asynchronous `safeStorage` API. The returned representation is `sealed:dobius-adam-intent:v1:` plus canonical base64 ciphertext, capped at ADAM's 64 KiB sealed-envelope limit. The module has no import-time safeStorage calls; the default main-only factory resolves Electron bindings when `seal()` runs.

The adapter requires app readiness, a stable supported Electron version, positive async availability before encryption and again before returning, and unchanged app/storage/platform/backend snapshots around each await. It refuses Linux `basic_text`, `unknown`, and every backend outside the explicit libsecret/KWallet allowlist regardless of availability. It requires Electron **42.4.1 or later stable** before any async secret API call. The current installed package reports Electron 42.3.3, so the production factory currently refuses; this packet does not change package metadata or prove a runtime backend.

Electron's [v42.4.1 safeStorage documentation](https://raw.githubusercontent.com/electron/electron/v42.4.1/docs/api/safe-storage.md) identifies safeStorage as a main-process API, recommends its asynchronous methods, documents `isAsyncEncryptionAvailable()` initialization behavior, and warns that Linux may use an unprotected fallback. The pinned [v42.4.1 implementation](https://raw.githubusercontent.com/electron/electron/v42.4.1/shell/browser/api/electron_api_safe_storage.cc) shows availability may return true for `basic_text` under a compatibility setting, so this adapter independently rejects that backend. Electron declarations only establish API typing; the pinned supported-version gate and future packaged platform tests are separate requirements.

The [official v42.4.1 release notes](https://releases.electronjs.org/release/v42.4.1) record fixes for async availability incorrectly reporting false shortly after app readiness and crashes when async encrypt/decrypt were called before initialization completed. This source guard adopts that release as the minimum verified version; it does not upgrade the installed package.

`createCloudJobAdamIntentSealerWithRuntime` is an internal test/composition seam. Its runtime/backend inputs are trusted code dependencies, never caller identity or authorization proof. The string-output check detects malformed, oversized, or visibly plaintext capability bytes; it cannot prove encryption or detect every reversible encoding from an arbitrary callback. Only the default Electron safeStorage binding is production-intended. There is no decrypt/unseal operation, transport/authentication, renderer/preload/RPC/CLI route, lifecycle wiring, ADAM caller, or recovery worker here.

## Verification

- Node 24.18.0 focused Vitest: 16 tests passed with `--maxWorkers=1`.
- Strict explicit-file TypeScript check: `--strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess`, ES2022, ESNext/Bundler; passed.
- Scoped oxlint and oxfmt checks: passed.
- All paths, hashes, exact commands, and remaining limits are recorded in `build1.json:adam-main-intent-sealer-source-20261014`.

No actual safeStorage/keychain call, platform backend probe, service/provider/device/DB operation, install, build, deployment, or live acceptance occurred.

## Input-error redaction correction (2026-10-14)

The follow-up correction moves strict envelope parsing, caller-controlled property reads, immutable identity copying, purpose-envelope parsing, and serialization inside the same fixed-error boundary as runtime and encryption work. Accessor, Proxy `ownKeys`, and Proxy `get` exceptions are now converted to the constant `CloudJobAdamIntentSealerError`; regression cases assert the message/name do not contain the synthetic capability and that no availability, backend-selection, or encryption call occurs. This catches thrown input behavior but does not make hostile Proxy execution safe in general or authenticate the caller.

**Correction task / dispatch:** `task_42d4bf7eabfe` / `ctx_849bb47093b9`. **Final scoped checks:** Node 24.18.0 focused suite 19 passed; explicit strict two-file TypeScript check, scoped oxlint, and oxfmt `--check` passed. Exact correction hashes and commands are recorded in `build1.json:adam-main-intent-sealer-redaction-correction-20261014`. This remains an unapplied seal-only source packet with no real Electron API calls, main lifecycle wiring, bridge/authentication, unseal, ADAM production caller or recovery integration, package upgrade, OS availability proof, or packaged/live acceptance.
