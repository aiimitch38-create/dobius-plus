# BUILD1 Telegram personal-account Teleproto adapter

Task `task_bf5bdd524875`, dispatch `ctx_22a22de228b8`, ROOT `term_2958d5fd-ff36-4ae7-9f23-6ed32a748f54`, runtime `6627a505-a9ea-4b59-90e7-d051eb153516`. Canonical repository is `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`.

## Result

Implemented a main-process personal-account MTProto adapter in the newly owned `dobius/src/main/telegram-account-mtproto/` folder. It implements BUILD2's `PersonalTelegramClient` contract with the installed `teleproto@1.230.0` package and preserves the existing service boundary. No BUILD2 service/types, shared API, preload, renderer, package, lockfile, frozen bridge/candidate, ADAM, or unrelated files were edited by this task.

The production runtime constructs `TelegramClient` and `StringSession` lazily when the factory is called, disables SDK logging, and does not connect until an operation requests it. The main-only factory requires explicit bounded `{apiId, apiHash}` input, snapshots it, and refuses malformed/proxy-throwing input with a fixed error. ROOT owns retrieval and encryption of these credentials and the protected session vault; this adapter neither provides defaults nor persists credentials itself.

Authentication requests use `sendCode`, then a raw `auth.SignIn` request. It never uses SDK `.start()` or sign-up; a `SESSION_PASSWORD_NEEDED` response is surfaced as a password-required state and the 2FA password callback is only used after that state. Session strings and SDK exception content are never logged or included in public errors. Abort and disconnect advance a generation, clear in-memory code handles/subscriptions/receipts, and disconnect the socket; late operations cannot publish results.

Dialog discovery is capped at 500 server-provided entities and does not fetch chat history. Only `Api.Chat` and `Api.Channel` entities with `megagroup` are eligible group kinds; user and broadcast-channel entries remain non-sendable. Incoming delivery accepts only incoming plain text from group/supergroup entities, rejects outgoing, service, media and oversized messages, and emits stable signed numeric peer IDs. The durable caller's signed 64-bit `random_id` is passed unchanged as a Teleproto `big-integer` to `messages.SendMessage`. Local receipt memory is bounded to 512 confirmed sends; after reconnect, unknown IDs stay `unknown` because there is no supported server random-id lookup. `revokeAuthorization()` is distinct from local disconnect and returns `true` only for a typed `auth.LoggedOut` response.

## Frozen owned source

All ten source/test modules are under the assigned new adapter directory; each is at or below the 300-line counted limit.

| Path | SHA-256 |
|---|---|
| `dobius/src/main/telegram-account-mtproto/index.ts` | `205792ee6be1bd3fbd40f44b44257dc8c6a5ae656ad7516863e54f8cdc479b9a` |
| `dobius/src/main/telegram-account-mtproto/personal-client.test-support.ts` | `82636d14249bc480fab97ae60e2203e4c31a9b189886193ec33b01ebc6dca3c5` |
| `dobius/src/main/telegram-account-mtproto/personal-client.test.ts` | `13ca221baa1ed1ba5b266555d71961bc9caddbab3b46412292429534b284a19f` |
| `dobius/src/main/telegram-account-mtproto/personal-client.ts` | `de3a4cb5f66921a309643e684176d143394314f937d9316f2e7160219b296d5f` |
| `dobius/src/main/telegram-account-mtproto/telegram-auth-session.ts` | `33eacaca453eb6bed4dfceac43ef71c574f63c22f9d2340861ec774bd8532818` |
| `dobius/src/main/telegram-account-mtproto/telegram-errors.ts` | `6cc239458f3fb023ed58183dc4bce3cd74ac0bb4a89c19e0dad744608c9c4a05` |
| `dobius/src/main/telegram-account-mtproto/telegram-events.ts` | `10dda6c7d990a42d418adcb3d735a1392f7767861b543b3bd4730b1126acb70a` |
| `dobius/src/main/telegram-account-mtproto/telegram-factory.ts` | `962ab882ef542e0ec76326da47c25cfb8fab86839b6bd06705b877eb05fc7899` |
| `dobius/src/main/telegram-account-mtproto/telegram-peer.ts` | `60801a4edeac6c08bf5961874173fc8ebf1a77600a346dae253231507c70cb72` |
| `dobius/src/main/telegram-account-mtproto/teleproto-runtime.ts` | `4a53bebc95fca4d60af8f5839fa03a49843ce736366d1986280d6cb1bb8d3e7e` |

## Verification

Node used: `/Users/bayou/homebrew/opt/node@24/bin/node`, v24.18.0. Installed SDK package is `teleproto@1.230.0` (ROOT-managed; package/lock files were not changed here).

- PASS, 4 focused Vitest files / 42 tests, maxWorkers=1: `/Users/bayou/homebrew/opt/node@24/bin/node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts src/main/telegram-account-mtproto/personal-client.test.ts src/main/telegram-account/service-auth.test.ts src/main/telegram-account/service-replies.test.ts src/main/telegram-account/vault.test.ts --maxWorkers=1`.
- PASS, scoped strict TypeScript with project unused checks: `/Users/bayou/homebrew/opt/node@24/bin/node node_modules/@typescript/native-preview/bin/tsgo.js --ignoreConfig --noEmit --strict --noUnusedLocals --noUnusedParameters --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --types node src/main/telegram-account-mtproto/*.ts`.
- PASS, scoped lint: `node_modules/.bin/oxlint src/main/telegram-account-mtproto`.
- PASS, scoped format: `node_modules/.bin/oxfmt --check src/main/telegram-account-mtproto`.
- PASS, `git diff --check`.

Coverage includes raw code-sign-in request construction, 2FA gating, refusal of sign-up, redacted accessor/auth errors, bounded dialog enumeration and entity classification, event filtering, exact random-id request construction, unknown-send handling, group-kind refusal, abort/late callback fencing, local disconnect, and confirmed/unconfirmed remote logout results. Tests use synthetic SDK bindings and fake entities only; no Telegram API/network, account, credentials, keychain, device, service, or head-agent action occurred.

## Limits

This is source and synthetic-test acceptance only. It does not prove application packaging, the current platform's Teleproto network/update behavior, event delivery continuity, gap recovery, protected storage availability, actual enrollment or API credential provisioning, or live account sign-in/revocation. Teleproto/Telegram does not provide a trustworthy general `random_id` lookup for this adapter, so unknown sends remain unknown and the adapter does not retry them. Dialog discovery is intentionally capped at 500 and does not claim a complete account inventory. Service consent and reply-routing remain outside this adapter; it makes no model/provider calls. AWS remains deferred and the historical Storage queue remains paused.

## ROOT typecheck correction

ROOT reported the project `noUnusedParameters` diagnostic for the stored `saveSession` parameter-property. The parameter-property modifier was removed while preserving the constructor parameter and its `TelegramAuthSession` wiring. The exact scoped command above passed with both `--noUnusedLocals` and `--noUnusedParameters`; the focused 42-test suite, scoped lint and formatting checks also passed again. The earlier one-shot worker completion IPC attempt was refused because the Dobius app socket was unavailable; no restart, retry, or polling was performed, and this report is the fallback receipt.
