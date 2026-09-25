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
- Spec test "consumed QR fails": implemented for phone QRs in review round 1 (see below).
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

## Review round 1 (coordinator security review: F1 medium, F2–F6 low)
Branch first merged `stabilize/integration` (brings the 009C2 fix; the two
`dobius-runtime.test.ts` "pre-marks remote Codex" cases now pass).

- **F1 single-use phone QR.** `DeviceRegistry.consumePairingOffer(token)`: for a pending
  (`lastSeenAt === 0`) *mobile* entry it mints a new 48-hex token, stamps `lastSeenAt`, saves, and
  returns it; on a save failure it restores the old values and throws. `E2EEChannel` gets an
  optional `claimToken` that runs right after `validateToken` in the same synchronous call (two
  sockets racing on one QR: the second sees the swapped registry and is refused). The new token
  goes to the client only inside the encrypted `e2ee_authenticated {deviceToken}`; the channel
  binds itself to it. If the swap throws, the login fails (never a live QR token, never an unsaved
  token). Phone: `rpc-client` adopts it for all later frames and reconnects
  (`getDeviceToken()`, `onDeviceTokenRotated`); `pair-scan` / `pair-confirm` save
  `client.getDeviceToken()` instead of the scanned token; `client-context` persists a rotation via
  `saveHost`. **Runtime-scope links (web client, desktop remote hosts, CLI) are not rotated:**
  one link is used by several sockets at once (`sendRemoteRuntimeRequest` opens a socket per
  call, the desktop holds a shared-control and a request connection per environment, the web
  client opens sibling clients, CLI processes run in parallel) and it is stored in places the
  server cannot update together (CLI env files, the main-process environment store, browser
  storage). A first-use swap would be won by one socket and every concurrent sibling presenting
  the link would be locked out. Those links stay listed and revocable in Settings. Listed under
  Decisions for Carson.
- **F2** `getOrCreatePendingDevice` mints a fresh mobile offer when less than 5 min of its 15 min
  would remain. Constants moved to `src/shared/mobile-pairing-offer-lifetime.ts`.
  `usePairingQrAutoRefresh` (renderer) re-fetches the QR every 4 min while it is shown in
  `MobilePane` and on `MobilePage` step 2, so the shown QR is at most 14 min old.
- **F3** Live-pid sockets are probed with an injectable probe: ENOENT/ENOTSOCK → remove after one
  probe; ECONNREFUSED → probe again after 200 ms and remove only if it refuses (or is gone) again;
  connect, timeout or other errors keep it.
- **F4** Pre-auth sockets remember their remote address and whether they sent any frame (a v2
  client's first frame is `e2ee_hello`). At the global cap, the oldest socket that never sent a
  frame is evicted first, else the oldest pre-auth one. New per-address cap of 16 sockets that
  have not logged in (1013 "Too many pending connections"); a logged-in socket stops counting.
- **F5** Per-direction frame counters, same v2 bump, all six client sites plus the server.
  Carried in the authenticated 24-byte NaCl nonce rather than a plaintext field:
  `[direction 0x01 c→s / 0x02 s→c][uint64 counter][15 random bytes]`. XSalsa20-Poly1305
  authenticates the nonce, so it is as tamper-proof as a field inside the plaintext, and every
  RPC/terminal frame format (text JSON and binary stream frames) stays untouched. The random
  tail keeps nonces unique if a replayed hello makes the server re-derive a key it used before.
  Receiver rule: open the box first, then require the peer's direction byte and a counter
  exactly one above the last accepted one (round 2; forged frames never move the counter). Implemented once in
  `src/shared/e2ee-sequencing.ts` (per shared-key object, via WeakMap, so no call-site signature
  changes) and used by `shared/e2ee-crypto.ts` (server + CLI + desktop remote hosts) and
  `renderer/web/web-e2ee.ts`; the Expo app has a byte-identical copy
  (`mobile/src/transport/e2ee-sequencing.ts`, guarded by `e2ee-sequencing-mirror.test.ts`).
  Clients switch it on when `e2ee_ready` carries `version >= 2` and a challenge
  (`beginE2EEAuth`), so they still talk v1 to an older desktop. The server switches it on after
  the challenge checks out, starting from the auth frame's counter
  (`enableE2EESequencingFromFirstFrame`), so a v1 client still receives its
  `client_update_required` error in a format it can decrypt; a v2 auth with a non-sequenced nonce
  is refused ("Unsequenced e2ee_auth"). Replayed, reordered and reflected frames are dropped as
  decrypt failures (server: counts toward the 5-failure close).
- **F6** `mobile/scripts/repro-terminal-colors.ts`, `repro-worktree-startup-stream.ts`,
  `test-subscribe.ts` now use one helper, `mobile/scripts/e2ee-script-session.ts` (v2 hello,
  challenge echo, counters, adopts a rotated token without printing it; it caches the last
  decrypted frame because each script decrypts every frame in two listeners). Checked ad hoc
  against a real `DobiusRuntimeRpcServer` (temporary test, not committed; Metro/expo tsconfig
  keeps `mobile/scripts` out of the main vitest project).
- **Update prompt.** New phone `ConnectionState` `'update-required'`: on `e2ee_error`
  `client_update_required` the client stops (no auth-retry loop) and the home card / session
  header read "Update the Dobius+ app" (`classifyConnection` verdict kind `update-required`,
  red status dot, no Reconnect button). This only helps phones built from this commit onward;
  a phone app from before handshake v2 still shows its old "Auth failed".
- Line budgets: `pair-scan.tsx` and the two repro scripts are at their `mobile/.oxlintrc.json`
  max-lines ceilings, so the new code was folded into the shared script helper and an inline
  `client?.getDeviceToken() ?? offer.deviceToken`; the v2 phone tests moved to
  `rpc-client-handshake-v2.test.ts` (rpc-client.test.ts is at its 800-line cap).

### Tests added in this round (all seen failing with the fix removed)
`device-registry-consume.test.ts`, `runtime-rpc-pairing-consume.test.ts` (real server: QR token
refused after first use, phone token works, runtime link reusable), `rpc/e2ee-channel-session.test.ts`
(in-session replay, reorder, replayed auth frame, unsequenced v2 auth, token handoff, failed swap),
`shared/e2ee-sequencing.test.ts` (order, replay, reorder, reflection, forged frame does not move
the counter), `shared/e2ee-sequencing-mirror.test.ts`, `shared/mobile-pairing-offer-lifetime.test.ts`,
`renderer/.../use-pairing-qr-auto-refresh.test.ts`, the F2 case in
`device-registry-pairing-expiry.test.ts`, 4 F3 cases in `runtime-socket-sweep.test.ts`, 2 F4 cases in
`ws-transport-admission.test.ts`, `mobile/.../rpc-client-handshake-v2.test.ts` (challenge + sequencing
on, v1 fallback, token adoption, update-required), `mobile/.../connection-health.test.ts`.
Existing server tests now switch counters on for their hand-built clients.

Mutation checks (each failed its tests, then restored): N1 claimToken not wired (1); N2 no swap
(1); N3 no revert on failed save (1); N4 new token not sent (1); N5 no 5-min margin (1); N6 one
refusal unlinks (2); N7 no per-address cap (1); N8 evict oldest regardless of hello (1); N9 counter
not enforced (5); N10 server never sequences (7); N11 phone ignores new token (1); N12
update-required handled as auth failure (1); N13 mobile mirror drift (1); N14 QR refresh slower
than the reuse window (1).

### Decisions for Carson (added)
- Runtime/web/CLI pairing links are not single-use (reason above); they remain revocable.
- If saving the swapped phone token fails, the pairing attempt fails and the user scans a new QR.

## Review round 2 (re-review: F1 medium, F2–F4 low)
- **F1 deleted frames.** `acceptE2EEReceivedNonce` (shared + byte-identical mobile mirror) now
  accepts only `counter === received + 1`; WebSocket over TCP is in-order and lossless, so any
  gap is a frame removed on the path. An authentic frame that fails the rule marks the key
  `violated` (`isE2EESequenceViolated`); a frame that merely fails to authenticate does not.
  Server: `E2EEChannel` closes at once with 4004 "Out-of-sequence frame" (not via the 5-strike
  decrypt counter, which still applies to unauthenticated noise). Web client and phone: close
  the socket; the existing close handler reconnects with a fresh key and counters. Shared
  desktop/CLI clients already treat any undecryptable frame as fatal (one-shot request fails,
  request/shared-control connections close); now covered by tests. Phone sockets set
  `binaryType = 'arraybuffer'` so binary frames are read synchronously and decrypt in arrival
  order (a Blob read is async and could let a later text frame decrypt first).
- **F2 stripped ready.** The phone remembers whether this socket's `e2ee_ready` offered v2. A
  `client_update_required` after a v1-looking ready is contradictory (a real older desktop never
  sends it), so the phone closes and reconnects with backoff instead of latching
  `update-required`. After a v2+ ready it still latches (a future desktop rejecting this app).
- **F3 grace for the consumed QR.** On first use the registry stores the QR token as
  `pairingToken` with `pairingTokenExpiresAt = now + 10 min` (`MOBILE_PAIRING_TOKEN_GRACE_MS`),
  persisted and validated on load. While it is live the QR still authenticates, and each such
  login mints yet another token (the previous issued token dies), so two parties never share one
  token. The first login with the phone's own token (a later connection, since
  `consumePairingOffer` runs only at handshake time) retires the QR at once; otherwise it dies
  when the window ends. Pair screens now say "scan a fresh QR code from your computer" on auth
  failure and on a local save failure.
- **F4** Silent-first eviction applies only to sockets silent for at least 1 s
  (`SILENT_EVICTION_MIN_AGE_MS`, test override `silentEvictionMinAgeMs`); otherwise the oldest
  pre-auth socket goes. A phone's socket mid-connect is no longer the preferred victim.

Tests (all seen failing with the fix removed): `shared/e2ee-sequencing.test.ts` (deleted frame,
violation flag set for replay/reorder, not set for noise), `rpc/e2ee-channel-session.test.ts`
(4004 on replay, reorder, replayed auth, deleted frame; 4 noise frames tolerated),
`renderer/src/web/web-runtime-client-sequence.test.ts` (gap and replayed binary drop the socket;
noise does not), `shared/remote-runtime-client-sequence.test.ts` (one-shot and persistent shared
clients fail on a gap from a v2 mock server), `mobile/.../rpc-client-handshake-v2.test.ts`
(out-of-sequence → close + reconnect, stripped ready + update_required → retry, v3 ready +
update_required → latch, arraybuffer), `device-registry-consume.test.ts` (rescan in grace with a
new token each time and after restart, retire on own-token login, expiry at 10 min),
`runtime-rpc-pairing-consume.test.ts` (real server: rescan, own-token login, then QR refused),
`ws-transport-admission.test.ts` (brand-new silent phone socket survives).
Existing channel/integration tests read the auth ack before later server frames.

Mutation checks: R1 gaps accepted (4 fail); R2 server not fatal (4); R3 web keeps socket (2);
R4 phone keeps socket (1); R5 shared-client test with the gap removed (2, proves the test);
R6 latch after stripped ready (1); R7 no arraybuffer (1); R8 no grace (2); R9 never retired
early (1); R10 grace never expires (1); R11 new silent socket evicted (1).

### Decisions for Carson (round 2)
- A used phone QR stays valid for up to 10 minutes, or until the phone first connects with its
  own token, whichever comes first, so a failed save on the phone can rescan the same QR. Within
  that window anyone holding the QR can still pair; each use rotates the issued token.
- An out-of-sequence frame drops the connection (phone/web reconnect automatically).
