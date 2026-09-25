# REPAIR BUILD-035 — Remote session security (#17 #19 #20 #22 X8 N11) · Upstream

Builds on BUILD-003/003B (listener off by default), 016 (keypair/registry never regenerated) and
034 (mobile RPC grants). None of those are changed: grants, the default-deny method classes, the
listener toggle and the keypair load path are untouched.

## Bugs and root causes
- **#17 (B1)** `rpc/e2ee-channel.ts` handshake had no freshness. The server key is static and the
  client's hello carries only its ephemeral public key, so replaying a sniffed hello re-derives the
  same shared key and the sniffed encrypted `e2ee_auth` decrypts and authenticates. The attacker
  then replays the captured encrypted RPC frames (terminal input, etc.) without ever knowing a key.
  Plain `ws://` on `0.0.0.0` is by design (E2EE instead of TLS; listener off by default since 003).
- **#19 (B3)** `device-registry.ts`: a pending (never-connected) mobile entry is a full device
  token with no expiry; `ipc/mobile.ts` `mobile:listDevices` hides pending entries, so an old QR
  screenshot stayed a valid, invisible login forever.
- **#20 (B6)** `rpc/ws-transport.ts`: at 128 sockets every newcomer was refused (1013), including
  the phone. The 10 s pre-auth timeout does not help: a LAN client just reconnects.
- **#22 (B8)** `===`/`!==` on secrets: `device-registry.ts validateToken`, `runtime-rpc.ts`
  `parseAndAuth` + the device-token mismatch check, `agent-hooks/server.ts` hook token.
- **N11 (deep B10)** `runtime-rpc.ts sweepOrphanedRuntimeSockets` kept any socket whose pid was
  alive. After a crash the pid gets reused by an unrelated process and the socket is never swept.
- **X8** four sub-items: (a) `runtime/tls-certificate.ts` was dead (only imported by a test;
  `tlsFingerprint` never set) and `ws-transport.ts` carried an unused wss branch whose comment
  claimed protection that never ran; (b) two CLI installers wrote the same `~/.local/bin` names;
  (c) dead `orb:close` handler; (d) pairing QR accepts any host from the renderer.

## Fix
- **Handshake v2 (#17).** New `src/shared/e2ee-handshake.ts`. On hello the server makes a 32-byte
  random challenge and sends `{type:'e2ee_ready', version:2, challenge}`; the client must echo it
  inside its encrypted `e2ee_auth`. The challenge is public but only the holder of the client's
  ephemeral secret can encrypt it under the shared key, so a replayed auth carries a stale
  challenge and is refused (`bad_auth`, close 4001 "Stale e2ee_auth"). The challenge is compared
  in constant time and cleared once the channel is ready or destroyed.
- **Old clients.** An `e2ee_auth` with no `challenge` gets an encrypted
  `e2ee_error {code:'client_update_required', message:'This Dobius app is too old ... Update the
  app, then reconnect.'}` and close code 4010 "Client update required". Accepting it would reopen
  the replay hole, so there is no legacy fallback (fail closed).
- **Clients updated in this repo** (wire change: one new optional field each way):
  `src/shared/remote-runtime-client.ts` (2 sites), `remote-runtime-request-connection.ts`,
  `remote-runtime-shared-control-frame-handler.ts` (desktop remote hosts + CLI),
  `src/renderer/src/web/web-runtime-client.ts` (browser client), and the Expo phone app
  `mobile/src/transport/rpc-client.ts` (inline copy; Metro cannot import `src/shared`). New clients
  omit the field when the server sent no challenge, so they still work against older desktops.
  `mobile/scripts/mock-server.ts` is an old-protocol mock and still works with the new client.
- **Phone impact.** A phone app built before this commit fails to authenticate against an updated
  desktop. It receives the error above; the installed app shows its generic "auth failed" state
  after its 3 retries (it cannot render a message it does not know). The phone app must be rebuilt
  from this commit. `MOBILE_PROTOCOL_VERSION` is unchanged (RPC semantics did not change).
- **#19** `MOBILE_PAIRING_OFFER_TTL_MS = 15 min`. `validateToken` refuses a mobile entry with
  `lastSeenAt === 0` older than the TTL (also legacy entries already on disk).
  `getOrCreatePendingDevice` never re-issues an expired offer: it rotates it (drops + mints). A
  phone that connected once (`lastSeenAt > 0`) never expires. Runtime-scope links keep no TTL:
  they are listed and revocable in Settings (`mobile:listRuntimeAccessGrants`).
- **#20** `ws-transport.ts` tracks unauthenticated sockets in insertion order. At the cap, the
  oldest unauthenticated socket is terminated and the newcomer admitted; a socket leaves the set on
  `setClientId` (auth) or close. If every slot is authenticated the newcomer still gets 1013, so an
  authenticated phone is never displaced by an unproven client.
- **#22** New `src/main/lib/constant-time-equal.ts`: sha256 both sides, `timingSafeEqual`; false
  for non-strings and an empty expected value, never throws on length mismatch. Used at the four
  sites above and for the handshake challenge.
- **N11** `sweepOrphanedRuntimeSockets` is now async and awaited in `start()`. Dead pid
  (`isPidAlive` from `lib/is-pid-alive.ts`) → remove. Live pid → connect-probe the socket
  (500 ms): `ECONNREFUSED`/`ENOENT`/`ENOTSOCK` → orphan, removed; connect, timeout or any other
  error → kept. Own pid still skipped. The unlink failure is now logged instead of swallowed.
- **X8** (a) deleted `tls-certificate.ts`, the `tlsCert/tlsKey` options + https branch in
  `ws-transport.ts`, and the never-set `tlsFingerprint` / `getTlsFingerprint()` in
  `runtime-rpc.ts`; comments now say why there is no wss. (b) `dobius-cli/install-clis.ts` now only
  writes a script that is missing, its own (`# dobius-cli v`) or a legacy voice-bridge script. It
  no longer overwrites the Voice Conductor's `dobius-send/-tabs/-status` (the conductor installer
  already refuses non-Dobius files and replaces `# dobius-cli` copies), nor a user's own script.
  `dobius-task-done` is unaffected. (c) **REFUTED**: `grep -rn "orb:close"` over the whole
  worktree (main, preload, renderer, legacy V1) finds nothing; the handler is already gone.
  (d) **REFUTED as a vulnerability**: manual host entry is a feature (`MobilePage.tsx:257-270`, `handleAddressChange`,
  "user-typed manual entry"; `resolvePairingEndpoint` accepts `ws(s)://` URLs for proxies). The QR
  pins the server's E2EE public key (`runtime-rpc.ts createPairingOffer`), and auth is encrypted to
  that key, so a wrong host can neither read the token nor impersonate the desktop. A renderer able
  to choose the host can already read the token from the same IPC reply.

## Tests (all seen failing with the fix removed, passing with it)
- `rpc/e2ee-channel-replay.test.ts` (new): captured hello + auth replayed on a new connection is
  refused; challenges differ per connection (32 bytes); a pre-v2 auth gets `client_update_required`
  + 4010; a non-string challenge is refused without throwing.
- `rpc/e2ee-channel.test.ts`, `rpc/e2ee-integration.test.ts`, `runtime-rpc.test.ts`: handshake
  helpers echo the challenge; ready frame asserts `version: 2`.
- `device-registry-pairing-expiry.test.ts` (new): inside TTL ok; after TTL refused (also after a
  restart); expired offer never re-issued; paired phone valid after 30 days; runtime links keep no
  TTL; legacy on-disk pending entry expires; wrong-length/prefix/empty tokens refused.
- `rpc/ws-transport-admission.test.ts` (new, real sockets on ephemeral ports): 128 idle pre-auth
  sockets → the 129th client is admitted and the oldest idle one evicted; an authenticated socket
  survives a 148-socket flood and can still open another; all-authenticated → 1013.
- `lib/constant-time-equal.test.ts`, `runtime-rpc-token-compare.test.ts`,
  `agent-hooks/server-token-compare.test.ts` (new): bad lengths/non-strings; each boundary calls
  `constantTimeEqual`.
- `runtime-socket-sweep.test.ts`: the live-pid case now needs a real listener; new N11 case uses a
  SIGKILLed child's leftover socket inode with a live (reused) pid → removed.
- `dobius-cli/install-clis.test.ts`: conductor copies of the 3 shared names kept; user script
  kept; own older copy upgraded.
- `src/shared/e2ee-handshake.test.ts` (new) and `mobile/src/transport/rpc-client.test.ts`:
  clients echo the challenge, omit it for an old server.
- `ws-transport.test.ts`: TLS fixture removed (plain ws); behaviour tests unchanged.
- `remote-runtime-request-connection.integration.test.ts` (unchanged) runs the real server with
  the real shared client end to end over handshake v2.

Mutation checks (each made its test fail, then restored): M1 accept mismatched challenge (2 fail);
M2 accept legacy auth (1); M3 no expiry in validateToken (2); M4 re-issue expired offer (1);
M5 no eviction (2); M6 authenticated sockets stay evictable (2); M7 runtime token `!==` (1);
M8 device token `===` (1); M9 hook token `!==` (1); M10 timingSafeEqual on raw buffers (1);
M11 pid-only sweep (1); M12 installer overwrites conductor copies (2); M13 shared client drops
challenge (5, incl. the real-server integration test); M14 phone drops challenge (1).

## Deviations from EXECUTION-ORDER.md
- Files outside the spec list, all required by the wire change or X8: `src/shared/e2ee-handshake.ts`
  (new), `src/shared/remote-runtime-client.ts`, `remote-runtime-request-connection.ts`,
  `remote-runtime-shared-control-frame-handler.ts`, `src/renderer/src/web/web-runtime-client.ts`,
  `mobile/src/transport/rpc-client.ts`, `src/main/lib/constant-time-equal.ts` (new),
  `src/main/dobius-cli/install-clis.ts` (X8 installer overlap).
- Spec test "consumed QR fails" is not implemented: after first use the QR token IS the phone's
  long-term credential (no rotation exists), so a consumed QR can only be killed by revoking the
  device, which is now visible in the list. Rotating the token on first use needs a new storage
  path in the phone, web and CLI clients; left for a follow-up.
- #19 "hidden from the device list": pending mobile offers stay out of `mobile:listDevices`
  (the onboarding badge and pairing flow count that list as "paired"); instead they now expire in
  15 min and are rotated by "Regenerate". `ipc/mobile.ts` only got a comment fix (TLS → E2EE).
- Non-constant-time compares outside the bug's three named places are left alone
  (`claude-agent-teams-service.ts:105`, `dobius-runtime.ts` launchToken).

## Decisions for Carson (implemented default in brackets)
- No legacy handshake fallback [off]: an old phone app cannot connect until rebuilt.
- Mobile pairing QR lifetime [15 min]; runtime/web links [no expiry, revocable in Settings].
- Shared CLI names [the Voice Conductor's `dobius-send/-tabs/-status` win once it has run].

## Rollback
Revert the commit. The protocol change is backward compatible for new clients against an old
desktop; old clients against a new desktop get `client_update_required`. Registry file format is
unchanged; expired pending entries are simply valid again after a revert.

## Verification
- `pnpm run typecheck` exit 0. oxlint + react-doctor clean on every changed file; oxfmt applied to
  my hunks only (unrelated reformat hunks reverted).
- Targeted: src/main/{runtime,agent-hooks,dobius-cli,lib,voice-conductor}, shared remote-runtime
  client tests, CLI websocket transport, web runtime client: 2303 passed; 3 failures are baseline
  (`web-runtime-client.test.ts` is in basefail; the two `dobius-runtime.test.ts` "pre-marks remote
  Codex workspaces trusted" cases fail identically with this diff reverted). Mobile transport
  (mobile/vitest.config.ts): 59 passed.
- Full suite: DEFERRED to the coordinator.

## Lessons
- Connecting to a regular file named `*.sock` fails with ENOTSOCK on macOS, not ECONNREFUSED;
  a real leftover socket inode needs a SIGKILLed listener to reproduce.
- The mobile vitest config runs from `dobius/` (`--config mobile/vitest.config.ts`) without
  `mobile/node_modules`; its tests mock `./e2ee`.
