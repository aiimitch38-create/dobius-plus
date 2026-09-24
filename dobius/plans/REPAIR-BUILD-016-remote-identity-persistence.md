# REPAIR BUILD-016 — remote identity persistence (#34 #35) · Upstream

## Root cause
- #34 `runtime/e2ee-keypair.ts` `loadOrCreateE2EEKeypair()`: every failure after `existsSync()`
  (EACCES, corrupt JSON, wrong version, bad key length, oversized file, harden failure) fell into
  `catch { /* regenerate below */ }` and then `writeSecureJsonFile()` overwrote the file with a new
  keypair. The keypair is the desktop's pairing identity, so one transient read error silently
  broke every paired phone (they hold the old public key) and destroyed the old secret key.
- #35 `runtime/device-registry.ts` `load()`: any read/parse error set `devices = []`. The next
  pairing mutation (`addDevice`, `getOrCreatePendingDevice` on QR open, `rotatePendingDevice`,
  `removeDevice`) or `updateLastSeen` called `save()`, which wrote `[]` + the new entry over the
  real file, erasing every paired device token.

## Fix
- Both stores now read through BUILD-009 `readSafeJsonFile()` (missing / unreadable / ok, never
  writes on read). Writes stay on `writeSecureJsonFile()` so the 0600 / Windows-ACL hardening of
  these credential files is unchanged.
- e2ee-keypair: only ENOENT (stat, or `missing` from the read) creates a keypair. Any other stat
  error, oversized file, harden failure, invalid JSON or invalid key shape throws the new exported
  `E2EEKeypairUnreadableError(filePath, detail)` (errno / "invalid JSON" / "unexpected JSON shape",
  never file contents). Nothing is written. The only production caller,
  `DobiusRuntimeRpcServer.start()` (runtime-rpc.ts ~699), already wraps it in the WebSocket
  try/catch: the error is logged, the WS transport does not start, `e2eeKeypair` stays null, so
  `createPairingOffer()` returns `{available:false}` — pairing unavailable until the file is fixed
  or removed by the user. Unix socket runtime keeps working.
- device-registry: new `parseDevices()` validates the top-level array and that each entry has
  string `deviceId` + `token` (legacy scope → mobile mapping kept). On unreadable:
  `devices = []` (fail closed: no token authenticates), console.error once per detail, and
  `addDevice` / `getOrCreatePendingDevice` / `rotatePendingDevice` / `removeDevice` throw the new
  `DeviceRegistryUnreadableError`; `updateLastSeen` is a no-op. The file is never written.
  While unreadable, every public call re-reads the file, so a repaired file recovers without a
  restart and keeps its existing devices.
- Callers (checked): `ipc/mobile.ts` `mobile:getPairingQR` / `getRuntimePairingUrl` →
  `createPairingOffer` → the throw rejects the IPC invoke (surfaced error, no QR);
  `mobile:revoke*` → `revokeMobileDevice` / `revokeRuntimeAccess` call `getDevice` first, which
  returns null on an empty registry, so they return `{revoked:false}` without reaching the throw;
  `index.ts:1392` headless serve pairing → throws with the recovery message (fail closed).

## Tests
- New `src/main/runtime/e2ee-keypair.test.ts`: missing → create + reuse; table (corrupt JSON,
  wrong version, short key material, oversized, injected EACCES read) → throws twice, file bytes,
  mtime and directory listing unchanged; error names path + errno, not key material; repaired file
  loads the original identity.
- New `src/main/runtime/device-registry.test.ts`: table (corrupt JSON, wrong top-level shape,
  entry without token, injected EACCES read) → all four mutations throw, `updateLastSeen` no-op,
  token rejected, list empty, file bytes/mtime/dir listing unchanged; repair recovers without
  restart and keeps the old device; missing file = first run; legacy entry → mobile.
- EACCES is injected by a pass-through `node:fs` `readFileSync` mock because both stores chmod
  the file to 0600 before reading, so a real chmod 000 would be repaired, not fail.
- Updated `runtime-metadata.test.ts` "replaces oversized E2EE keypair files" → "refuses oversized
  ... without reading or replacing them" (the old test asserted the #34 bug).
- Mutation checks (each made the new tests fail, then restored; 15/15 green after):
  M1 keypair regenerates on unreadable (6 fail); M1b oversized regenerates (1); M2 registry
  mutations not blocked (5); M3 no re-read while unreadable (1); M4 parse accepts tokenless
  entries (1).

## Deviations from EXECUTION-ORDER.md
- Reuses `readSafeJsonFile()` from safe-json-file.ts rather than the `SafeJsonFile` class: the
  class saves via `writeJsonFileAtomic` (no 0600 / Windows ACL hardening) and writes a quarantine
  copy of the bad file; both are wrong for files holding secret keys and bearer tokens.
  safe-json-file.ts itself is not edited.
- BUG-MATRIX #34 also mentions "explicit rotation updates dependent grants" and #35 "retain a
  protected previous generation"; neither is in the EXECUTION-ORDER test line and both would be
  new features. Not done. Recovery today = user repairs or deletes the file (deleting the keypair
  creates a new identity; phones must re-pair).
- Edited an existing test (`runtime-metadata.test.ts`) that encoded the old behavior.

## Rollback
Revert the commit. No file formats changed.

## Verification
- `pnpm run typecheck` exit 0.
- oxlint + react-doctor config: clean on all 5 changed files (confirmed oxlint reports errors on
  a probe file, so empty output is real).
- Targeted: e2ee-keypair + device-registry 15/15; runtime-rpc + runtime-metadata +
  mobile-listener-setting 54/54; mobile-pairing-userdata-path 7/7 (with --testTimeout=240000;
  at default timeout its first test timed out under machine load avg ~80, and its late
  `appState.userData = lateDir` then leaked into test 2).
  `ipc/mobile.test.ts`: 1 failure (`qrDataUrl` in runtime pairing result) — baseline file in
  basefail.txt, unrelated to these stores.
- Full suite: DEFERRED (coordinator).

## Lessons
- A chmod-000 test cannot simulate EACCES for stores that call `hardenExistingSecureFile()`
  before reading; they chmod the file back to 0600 first. Inject the read error instead.
