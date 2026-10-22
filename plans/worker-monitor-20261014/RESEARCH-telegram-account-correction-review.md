# Telegram account correction: independent connection review

**Task / dispatch:** `task_68fec1bfafe8` / `ctx_cda37221d01e`  
**Reviewer:** RESEARCH (`term_d892e988-92d2-4eeb-9694-89e5853a18f9`)  
**Coordinator / runtime:** `term_2958d5fd-ff36-4ae7-9f23-6ed32a748f54` / `6627a505-a9ea-4b59-90e7-d051eb153516`  
**Repository / branch:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, `fix/channel-cost`  
**Verdict:** `PASS_ACCOUNT_CONNECTION_SOURCE_ONLY`

## Freeze and evidence

Before and after review, all 55 paths and byte counts in `plans/worker-monitor-20261014/ROOT-telegram-source-freeze-v2-20261016.json` matched. Manifest SHA-256: `5c5f3c2ba068409a320f4bb68e744c39161ed7522a4290a19bf97a1ae7d773eb`. The reviewed six-file correction subfreeze is also the `followup` receipt under `telegram-paused-revoke-correction-20261016` in `plans/cloud-workstation-reports-20261012/build2.json`; its current files match that receipt, including the new `connection-stop.ts`. The 90-test receipt is the follow-up receipt; the top-level 89-test / five-file receipt and the older five-file hashes in the correction note are historical.

## Review findings

- `revokeTelegramAuthorizationFromPaused` is a dedicated logout path. It begins a new operation generation, stops/drains reply work, requires secure storage plus an existing account/session, reconnects with the saved session, validates the returned account identity, and calls only `revokeAuthorization`. It never subscribes, starts reply processing, invokes the model reply port, or sends a message. It clears the encrypted account/session and internal paused state only after a typed `true` logout result and a current generation check. `desktop-telegram-account.ts` persists `disconnected` only after that service result and its own view epoch remain current.
- False/throwing logout and failed reconnect leave the saved vault and paused preference intact. A superseding pause/disconnect invalidates the revoke generation. A late successful connect is disconnected; when shutdown is already underway, revoke cannot detach or publish over the newer operation. The connected-revoke path likewise checks the generation returned by `stopTelegramClient` after its await before clearing state. The deferred-disconnect test exercises the previously missing newer-pause race.
- Cleanup is best-effort at the SDK socket boundary: the adapter closes its own generation, clears auth, removes event handlers, and clears process-local receipts before swallowing an SDK disconnect error. No subscription is started by this revoke path. This is not proof that an OS socket was physically closed under arbitrary SDK failure, but it does not preserve a usable adapter or allow a stale control operation to publish state.
- The previously reviewed durable inbound ledger/publication fences remain present: update identity is durably reserved before inference; the 10,000-entry bound refuses further inference; a crash-left `processing` receipt becomes `manual-review`; publication checks generation, current account, selected group identity and selection epoch, and consent revision against current state before saving. A failed publication leaves the prior durable receipt to prevent replay.
- IPC exposes only the typed desktop account operations through the trusted renderer handler; there is no CLI/RPC credential surface. Production composition passes `replyToAdam: null` and `readConsent: null`, and the UI explicitly keeps participant consent pending and approval/send controls disabled. These are appropriate fail-closed defaults.

## Validation

Independent focused command, exit 0: Node 24, 10 files / 90 tests passed.

```sh
cd "/Users/bayou/Projects (Code)/Dobius/dobius-plus/dobius"
PATH="/Users/bayou/homebrew/opt/node@24/bin:$PATH" ./node_modules/.bin/vitest run --config config/vitest.config.ts src/main/telegram-account src/main/telegram-account-mtproto src/main/ipc/desktop-telegram-account.test.ts src/main/ipc/telegram-account src/main/ipc/register-core-handlers.test.ts src/renderer/src/components/settings/TelegramAccountSection.test.tsx --maxWorkers=1
```

ROOT's existing connected-revoke regression, run independently with a temporary config limited to `plans/worker-monitor-20261014/telegram-revoke-review/root-connected-revoke.test.ts`, exit 0: 1 file / 1 test passed. Temporary config: `/private/tmp/telegram-revoke-review-v2-vitest.config.cjs`. I did not edit the ROOT probe or add another product/source probe.

## Limits

This passes only the personal-account connection and pause/revoke source boundary. Tests are synthetic, including test-only encryption; I did not access a Telegram account, session, message, credentials, OS keychain, service, gateway or network. Participant consent authority, authenticated Hermes gateway, durable Telegram update recovery, actual login and live reply acceptance remain unproven/unconfigured; no build, package, install or live acceptance is claimed. AWS remains deferred and the historical Storage queue remains paused.
