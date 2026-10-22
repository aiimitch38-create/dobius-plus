# Telegram paused-revoke correction — BUILD2 source freeze

**Task / dispatch:** `task_6cc363ed9354` / `ctx_766a77e4ca86`  
**Coordinator:** `term_2958d5fd-ff36-4ae7-9f23-6ed32a748f54`  
**Repository / branch:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, `fix/channel-cost`  
**Verdict:** `SOURCE_CORRECTION_TESTED_NOT_LIVE`

## Correction

The desktop revoke wrapper now chooses a dedicated paused-session revocation operation instead of calling ordinary restore while paused. That operation reconnects only long enough to confirm remote authorization revocation; it does not clear the pause flag, subscribe to incoming messages, invoke Adam inference, or send a message. Ordinary `isCurrent` behavior remains unchanged. The wrapper writes the `disconnected` reconnect preference only after the typed service result confirms success and the wrapper control epoch is still current.

Failures (logout false, thrown logout, or reconnect failure) retain the encrypted session and `paused` preference. The revocation operation checks its generation after awaited steps; if a newer pause/disconnect supersedes it, it does not clear state or update preference. A connect that resolves after cancellation receives a late disconnect so it cannot remain attached after the operation has been fenced.

## Verification

Focused Node 24 Telegram suite: **10 files / 89 tests passed**.

```sh
PATH="/Users/bayou/homebrew/opt/node@24/bin:$PATH" ./node_modules/.bin/vitest run --config config/vitest.config.ts src/main/telegram-account src/main/telegram-account-mtproto src/main/ipc/desktop-telegram-account.test.ts src/main/ipc/telegram-account src/main/ipc/register-core-handlers.test.ts src/renderer/src/components/settings/TelegramAccountSection.test.tsx --maxWorkers=1
```

Scoped formatting and lint passed:

```sh
./node_modules/.bin/oxfmt --write src/main/ipc/desktop-telegram-account.ts src/main/ipc/desktop-telegram-account.test.ts src/main/telegram-account
./node_modules/.bin/oxlint --deny-warnings --no-ignore src/main/ipc/desktop-telegram-account.ts src/main/ipc/desktop-telegram-account.test.ts src/main/telegram-account
```

Project Node typecheck passed:

```sh
PATH="/Users/bayou/homebrew/opt/node@24/bin:$PATH" ./node_modules/.bin/tsgo --noEmit --composite false --incremental false -p config/tsconfig.node.json
```

Regressions cover same-process pause→revoke, paused restart→revoke, false/throwing logout and failed reconnect retaining pause/session, and concurrent pause fencing a pending revoke with late-connect cleanup. Existing relevant Telegram tests were retained.

## Limits

All transport and storage behavior was exercised with synthetic test doubles and test-only encryption. No Telegram account/login/network/message/gateway/keychain/device/service action, build, package, install, or live acceptance occurred. Production reply and consent authorities remain null; this correction does not enable ingestion or sending.

## Frozen source files (SHA-256 / bytes)

| Path | SHA-256 | Bytes |
|---|---|---:|
| `dobius/src/main/ipc/desktop-telegram-account.ts` | `37dc6fff8fdeb48b0111560a8be3af3f876b47050bda12f11e66a0995c91e158` | 5936 |
| `dobius/src/main/ipc/desktop-telegram-account.test.ts` | `7dd917e32ed8105cf019184d3a102994d239a793c93c6dd57446a6caf5d9e523` | 9725 |
| `dobius/src/main/telegram-account/connection.ts` | `33bc0be93b62df87396c441fbe9bb6fb5f02e437ae15dd1837ca0dc5da8c6b04` | 10533 |
| `dobius/src/main/telegram-account/connection-revocation.ts` | `d19521065053cce00238abaeb4c6a790a9249f030fe077dbadac2d9ac3f43d1b` | 3959 |
| `dobius/src/main/telegram-account/service.ts` | `5e239d2c836e9b6bba1f42bbbc2eecc0b279793e01228dafc854dca0e4127b61` | 9139 |

## ROOT connected-revoke shutdown follow-up

**Task / dispatch:** `task_6cc363ed9354` / `ctx_766a77e4ca86`  
**Follow-up status:** `RESOLVED`  

Connected revoke now treats client shutdown as part of its fenced operation. The shared shutdown helper returns the generation it began, checks that generation after stopping/draining replies before detaching the client, and callers verify it again after disconnect completes before changing account state. A newer pause or disconnect therefore keeps ownership of the resulting state instead of being overwritten by a late successful revoke. The helper lives in `connection-stop.ts` to keep the controller within the enforced source line limit.

The added deferred-disconnect regression starts a connected revoke, holds the client shutdown open, performs a newer pause, then releases shutdown. The revoke is rejected as stale; the encrypted session remains, the reconnect preference remains paused, and a newly created API stays paused without reconnecting. The test also asserts there is no subscription or message send.

Focused Node 24 Telegram suite: **10 files / 90 tests passed**. The scoped four-file formatter and linter both passed, and the full Node process typecheck passed.

```sh
PATH="/Users/bayou/homebrew/opt/node@24/bin:$PATH" ./node_modules/.bin/vitest run --config config/vitest.config.ts src/main/telegram-account src/main/telegram-account-mtproto src/main/ipc/desktop-telegram-account.test.ts src/main/ipc/telegram-account src/main/ipc/register-core-handlers.test.ts src/renderer/src/components/settings/TelegramAccountSection.test.tsx --maxWorkers=1
./node_modules/.bin/oxfmt --write src/main/ipc/desktop-telegram-account.ts src/main/ipc/desktop-telegram-account.test.ts src/main/telegram-account/connection.ts src/main/telegram-account/connection-stop.ts
./node_modules/.bin/oxlint --deny-warnings --no-ignore src/main/ipc/desktop-telegram-account.ts src/main/ipc/desktop-telegram-account.test.ts src/main/telegram-account/connection.ts src/main/telegram-account/connection-stop.ts
PATH="/Users/bayou/homebrew/opt/node@24/bin:$PATH" ./node_modules/.bin/tsgo --noEmit --composite false --incremental false -p config/tsconfig.node.json
```

Successor source freeze (the earlier five-file hashes above remain as historical evidence):

| Path | SHA-256 | Bytes |
|---|---|---:|
| `dobius/src/main/ipc/desktop-telegram-account.ts` | `37dc6fff8fdeb48b0111560a8be3af3f876b47050bda12f11e66a0995c91e158` | 5936 |
| `dobius/src/main/ipc/desktop-telegram-account.test.ts` | `2bbfbaa339685fc1242fafcda36997bd7dc932b553b2c3eb8c408289b02a26b8` | 10979 |
| `dobius/src/main/telegram-account/connection.ts` | `102d1e06d1331ca38522881c42691dc346cfa4da7a3d800c77132bf6c041984d` | 10653 |
| `dobius/src/main/telegram-account/connection-revocation.ts` | `d19521065053cce00238abaeb4c6a790a9249f030fe077dbadac2d9ac3f43d1b` | 3959 |
| `dobius/src/main/telegram-account/connection-stop.ts` | `6735e504f0096d9d4b41865c422381ec64888e5e397127ab8ef83d6b62c0934e` | 609 |
| `dobius/src/main/telegram-account/service.ts` | `5e239d2c836e9b6bba1f42bbbc2eecc0b279793e01228dafc854dca0e4127b61` | 9139 |

This remains source/test evidence only. No real account, network, provider, keychain, service, build, package, install, or live acceptance was exercised.
