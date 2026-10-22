# Telegram personal-account backend — BUILD2 source freeze

**Task / dispatch:** `task_4134bdbae608` / `ctx_39d2588523c7`  
**Coordinator:** `term_2958d5fd-ff36-4ae7-9f23-6ed32a748f54`  
**Repository:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`  
**Status:** Source-level race corrections implemented; ingestion remains default-disabled.

## Correction

The encrypted vault is now schema v2 with a bounded private inbound-event ledger keyed by exact account, group, and message IDs. A `processing` receipt is synchronously saved before the Adam reply callback is invoked; duplicates are ignored across concurrent callbacks and restart, crash-left processing entries become `manual-review`, and ledger exhaustion refuses new inference instead of evicting identities. Existing v1 encrypted vault data is accepted through a strict migration to an empty ledger.

Inference completion re-reads current state, checks account identity, current group kind/title, consent revision, operation generation, and a monotonic selection epoch, then merges the draft and receipt into that latest state in one save. Successful group-selection persistence advances the epoch, including deselect/reselect ABA; concurrent distinct replies therefore retain both drafts and stale results cannot restore old selection or overwrite new state. Disconnect and remote revoke preserve the receipt ledger.

## Verification

Focused Node 24 Vitest: **3 files / 28 tests passed**.

```sh
PATH="/Users/bayou/homebrew/opt/node@24/bin:$PATH" ./node_modules/.bin/vitest run --config config/vitest.config.ts src/main/telegram-account/service-replies.test.ts src/main/telegram-account/service-auth.test.ts src/main/telegram-account/vault.test.ts --maxWorkers=1
```

Scoped format and lint passed:

```sh
./node_modules/.bin/oxfmt --write src/main/telegram-account
./node_modules/.bin/oxlint --deny-warnings --no-ignore src/main/telegram-account
```

Focused strict TypeScript check passed:

```sh
PATH="/Users/bayou/homebrew/opt/node@24/bin:$PATH" ./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --types node,vitest/globals --skipLibCheck src/shared/telegram-account.ts src/main/telegram-account/*.ts
```

New regression coverage includes durable pre-inference admission and same-event concurrent deduplication; concurrent distinct-event state merge; deselection/reselection ABA fencing; restart replay after the bounded draft window has been pruned; crash-left `processing` recovery to `manual-review`; admission-capacity fail-closed behavior; and strict v1 encrypted-vault migration.

## Limits

Production `desktop-telegram-account.ts` still supplies `replyToAdam: null` and `readConsent: null`; actual message ingestion remains unavailable even though the service API accepts injected test ports. The present consent type proves only a synchronous sender/group allowed flag and revision, not complete participant coverage or ongoing per-person consent, platform authorization, or scoped Adam tool authority. No account login, Telegram message/group, provider, secret/keychain, device, build, install, service, or live activation was exercised; tests use synthetic clients and cipher. This source freeze does not establish packaged or live acceptance, post-restart Telegram update recovery, or outbound-send reconciliation.

## Frozen files (SHA-256 / bytes)

| Path | SHA-256 | Bytes |
|---|---|---:|
| `dobius/src/shared/telegram-account.ts` | `3e674cae55469b3f9d3141fa768a5637d121aa8153bf20c97a00b01f1068fcfa` | 2587 |
| `dobius/src/main/telegram-account/authorization.ts` | `ea571ea4024e541355228a070eb763774eea5bbcbed953e36dbd300904896cc5` | 7906 |
| `dobius/src/main/telegram-account/connection-operation.ts` | `0cd8ecf86703a3066086236825f1752216ff7f2f3ee4ad6916a81a20d3d2bc46` | 1184 |
| `dobius/src/main/telegram-account/connection.ts` | `3dfe57dffa3a7cdca433bd660fc65de7d2e5285312d3f207cf3a3ed0ef4e9523` | 10273 |
| `dobius/src/main/telegram-account/consent-policy.ts` | `fa8b4d958421fa0461d4a610387f6a925d70f7ee82bdca85eca889353fe31c5b` | 1058 |
| `dobius/src/main/telegram-account/draft-state.ts` | `2de9ddf2ea98a172d541c3c34f295321d81219d1871f35980fae3d922c135d36` | 730 |
| `dobius/src/main/telegram-account/incoming-message.ts` | `7a6eb1e99bb80755a4e663ca59827790f38fb6a445677d961b97f2c92d602d7a` | 9109 |
| `dobius/src/main/telegram-account/incoming-operation.ts` | `b1eee3db4cdf9fbd344f9ad41b8f8639816ba7891097b58f5a656cf79208d6e6` | 856 |
| `dobius/src/main/telegram-account/recover-state.ts` | `98eb4ee30415c5bb31b659fee277bcbcf70229a43ebf961be6ce8a08de2aafa6` | 954 |
| `dobius/src/main/telegram-account/replies.ts` | `20aa7f10e538d178758180226614603dfb29e8b13c6957917650bcd61266105a` | 9317 |
| `dobius/src/main/telegram-account/service-auth.test.ts` | `d715918e50dea35f82cadefa1cba8d47bd853958a96084641224edabaace88ce` | 10787 |
| `dobius/src/main/telegram-account/service-replies.test.ts` | `2e7f28ef84e4175fba40372c3274b6fb84cdc3305a69aa06970c666a505cea24` | 12724 |
| `dobius/src/main/telegram-account/service.ts` | `7e6d7fed258420f3a0f4035be3b4ba5aef73f003884549587549fcc8c6051d36` | 8963 |
| `dobius/src/main/telegram-account/test-support.ts` | `c8ed751a6f6e3281d55f538b44ed5ffeb42c1aeeb02b174ef21966bf249bd16e` | 4378 |
| `dobius/src/main/telegram-account/types.ts` | `297a8ac3e7f721703432520420d5aa913230e20d591aebd3543cf1f1a622cb20` | 3788 |
| `dobius/src/main/telegram-account/validation.ts` | `6ef72a220c2649d31d17d5e54f8d183e075411562927d4afef7af51030baea2c` | 2445 |
| `dobius/src/main/telegram-account/vault.test.ts` | `a4cf8cbf3f94be2cb2a95f3f599a94405354092262761f4e0b6b6a5a30d1aecb` | 3925 |
| `dobius/src/main/telegram-account/vault.ts` | `6ac7bbb712a5ad271159aaae0a12912f9da51723ad84c24f3443dc0fd35d255f` | 9241 |
