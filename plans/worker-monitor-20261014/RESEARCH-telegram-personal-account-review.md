# Telegram personal-account implementation: early source review

**Task / dispatch:** `task_f5dda6b02206` / `ctx_5ad36d33e0af`  
**Coordinator:** `term_2958d5fd-ff36-4ae7-9f23-6ed32a748f54`  
**Repository:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, branch `fix/channel-cost`  
**Verdict:** `CHANGES_REQUIRED_FOR_REPLY_ENABLEMENT` (moving source; not a freeze verdict)

## Scope and state

I read the active Telegram review brief, `dobius/AGENTS.md`, current account service/reply coordinator, vault and credential storage, teleproto adapter, IPC trust/API, preload API, Settings UI and focused tests. Telegram implementation files are still untracked work in this dirty worktree, and no author freeze was supplied. Hashes below identify the reviewed point-in-time bytes; they are not a claim that concurrent WIP stopped changing.

The installed/product composition is currently fail-closed for AI: `desktop-telegram-account.ts` supplies `replyToAdam: null` and `readConsent: null`; `startReplies()` is not part of the shared/preload API and no startup or UI caller invokes it. The settings UI explicitly says individual consent is pending and keeps approve/send controls disabled. Thus the callback defects below are blockers to enabling reply ingestion, not evidence that current installed code is reading Telegram messages or calling Adam.

## Material findings

### 1. Inbound update is neither reserved nor deduplicated durably before inference

In `replies.ts:179-219`, `handleIncoming` checks duplicates only against `state.drafts` (`:188-190,238-240`), then awaits `replyToAdam` (`:193-200`) before writing a draft (`:217-219`). Two callbacks for the same `(account, groupId, messageId)` can both pass the check and start two Adam requests. A prior event can be processed again after its draft rolls out of the 100-entry draft list; the vault stores no separate update receipt/cursor (`vault.ts:76-81` caps drafts and its schema has only account/session/groups/drafts/outbox).

**Synthetic reproduction:** the permitted disposable probe emits the same update twice while the reply port is deferred; it observes two calls to the Adam reply port. This demonstrates duplicate inference even though the eventual identical draft IDs leave one visible draft. The durable admission key must be reserved atomically before inference and retained independently of the bounded human-review draft window, including restart/replay behavior.

### 2. Pending reply publishes a stale whole-state snapshot and restores a deselected group

`handleIncoming` captures `state` at `replies.ts:183`, awaits the reply port, then checks generation and sender consent but not that the group is still selected (`:201-217`). It writes `{ ...state, drafts: ... }`, the entire old snapshot. `connection.ts:155-190` changes group selection and bumps only the public revision; `service.ts:isCurrent` compares the operation epoch and pause flag, not that revision. Therefore a legitimate `selectGroups()` that completes during inference does not stale the callback.

**Synthetic reproduction:** start a deferred reply for group `-1001`; save a new verified selection `[-1002,-1003,-1005]`; resolve the reply. The probe's final assertion expected the new selection and failed: current state had reverted to `[-1001,-1002,-1003]`. This also means independent inbound replies that captured the same snapshot can overwrite one another's drafts. The callback needs serialized/transactional admission and publication against current state, plus an explicit current-selection/authority check immediately before commit; merge-onlying drafts is insufficient if group authority changed.

### 3. Durable ambiguous-send record is retained, but the real adapter cannot reconcile it after restart

The service does preserve non-sent outbox records as `unknown` on local disconnect (`connection.ts:205-230`) and converts crash-left `prepared` sends to `unknown` on restore (`:289-307`). That is duplicate-safe. But the real adapter's `lookupRandomId()` only checks an in-memory `confirmed` map (`personal-client.ts:171-175`), which is cleared on `disconnect()` (`:177-184`). It does not query durable/server history for an old random ID. After restart/reconnect, an ambiguous send stays `unknown` indefinitely: the coordinator will not resend it, but cannot mark it confirmed from the actual adapter. A fake test's restarted client returns `confirmed`; that proves coordinator behavior with the fake, not real post-restart reconciliation. Preserve the receipt, but add an actual supported lookup/reconciliation source or present “unknown” as a permanent manual-review state. Explicit remote revoke currently clears the entire vault/outbox after successful logout (`connection.ts:255-265`); decide whether a minimal content-free receipt ledger must survive that operation.

### 4. Current consent contract is insufficient for future group-wide AI authorization

`ChatConsentProof` and `readConsent(groupId, senderId)` prove at most a decision for one sender; they do not attest the complete relevant participant set or individual continuing consent. Current production wiring is null and UI correctly reports consent pending. Do not wire a permissive boolean callback to enable AI: the future authority must establish participant completeness, per-person consent scoped to the exact group/content, applicable platform authorization, and the scoped Adam tool policy. The visible snapshot has no machine-readable “reply listener active / consent grant current” field, so it should not imply AI activation if composition later changes.

## Behaviors that currently fail closed / scope limits

- Main IPC checks the captured trusted `WebContents` identity, main-frame status and trust revision both before and after awaited handlers (`telegram-account-trust.ts`); public preload exposes only the typed account methods. No CLI/RPC route or arbitrary PTY route is present in the inspected API.
- Input validators require exactly three distinct server-returned group/supergroup IDs at save time; incoming adapter parsing excludes outgoing, media, channels and non-group dialogs. The adapter re-verifies destination group kind before sending.
- Vault and application credentials use the shared Electron safe-storage cipher and refuse unavailable encryption; Linux rejects the `basic_text` backend. Session, API hash, OTP and 2FA values are not returned in the account snapshot/audit. Tests use injected synthetic ciphers and do not prove actual OS keychain behavior.
- Cancel sign-in remains available while auth is busy; busy state clears transient form values on submit. No real login, Telegram account, message, group, keychain or provider action was performed.
- Startup restore reconnects only an existing encrypted session and does not subscribe to updates or load chat history. No current AI ingestion or outbound send is demonstrated.

## Validation

Focused Telegram Node24 suites, one worker, exit 0: 8 files / 61 tests passed on the current WIP retry (the earlier captured run was 60). Because the owners are editing concurrently, later hash checks observed further changes in Telegram test/support files; this test exit is evidence for the bytes exercised during that run, not a freeze-wide pass for all later bytes.

```sh
PATH="/Users/bayou/homebrew/opt/node@24/bin:$PATH" ./node_modules/.bin/vitest run --config config/vitest.config.ts src/main/telegram-account/service-replies.test.ts src/main/telegram-account/service-auth.test.ts src/main/telegram-account/vault.test.ts src/main/telegram-account-mtproto/personal-client.test.ts src/main/ipc/telegram-account.test.ts src/main/ipc/telegram-account-trust.test.ts src/main/ipc/telegram-account-credentials.test.ts src/renderer/src/components/settings/TelegramAccountSection.test.tsx --maxWorkers=1
```

Disposable race probe used a temporary Vitest config under `/private/tmp` and the test file below; it exited 1 with 1 passing and 1 failing test. The duplicate test passed while observing two reply-port calls; the second test failed exactly because the stale callback restored the old saved group selection.

```sh
PATH="/Users/bayou/homebrew/opt/node@24/bin:$PATH" ./node_modules/.bin/vitest run --config /private/tmp/telegram-review-vitest.config.cjs --maxWorkers=1
```

Probe: `plans/worker-monitor-20261014/telegram-review/race-probe.test.ts`. No implementation files were changed. No build/install, live service, account, keychain, device or head-agent action was taken. The initial orchestration status attempt and the single required completion attempt both failed with `Could not connect to the running Dobius app`; no restart or retry was made, and this report is the fallback.

The adapter and desktop composition were re-read after concurrent WIP edits: the adapter still has only process-local `confirmed` IDs, and desktop composition still supplies null AI/consent ports. Their hashes in the table are the latest capture. There is no single immutable aggregate to approve.

### Concurrent owner edits after the probes

The source continued changing during this review. A later re-read showed schema v2 with an encrypted `inboundEvents` ledger in `types.ts`/`vault.ts`, and a new `selectionEpoch` value passed from the service into the reply coordinator. This may be the start of a correction, but the inspected `replies.ts` still imports `./incoming-message` while that file was absent from the directory listing at the same instant; no implementation of admission-before-inference was available to review then. The refreshed point-in-time hashes were `connection.ts` `9308bf959de47c4ced47ab08f682b1dc9d5033e2e526f5f94222e31070649672`, `service.ts` `eb41950e38c6a209fec8168696b12936b32a1594b0d691a9b338189266cb2b9d`, `types.ts` `297a8ac3e7f721703432520420d5aa913230e20d591aebd3543cf1f1a622cb20`, `vault.ts` `4f1304d9bb0bd2bac4948e677fb6dcb344ead94bd0f5c719760fc3ad8dde1680`, and `personal-client.ts` `e3266f147954bf1aba471d303481832b8945789fe5d8383f022253a81cc6d3c8`. Because those edits were incomplete/moving, the two race findings remain reproduced against the prior readable implementation and the changed source is **unreviewed**, not fixed or accepted. The 61-test run preceded this partial edit and does not validate it.

## Reviewed source/test hashes (SHA-256)

The report JSON contains the expanded hash inventory and notes subsequent WIP drift. Selected critical hashes from the inspected implementation snapshot (later hashes are called out below):

| Path | SHA-256 |
|---|---|
| `dobius/src/main/telegram-account/replies.ts` | `2687add18c99eee64b391c8fb1f520772ad449d71264d695c32288da7d4bb8e1` |
| `dobius/src/main/telegram-account/incoming-message.ts` | `9f4497b39802e8ea700cce2cda68a75778b7b54d86767eec8bcdbcfe912d600d` |
| `dobius/src/main/telegram-account/consent-policy.ts` | `fa8b4d958421fa0461d4a610387f6a925d70f7ee82bdca85eca889353fe31c5b` |
| `dobius/src/main/telegram-account/connection.ts` | `bd42d33beb69f4d913c8452aca6223ed07efe7154938fa788963117265b64f23` |
| `dobius/src/main/telegram-account/service.ts` | `70fb4c3c27cdbb32a9eabc803960a104701d79a000854cf1345ca2a2bc7237f5` |
| `dobius/src/main/telegram-account/vault.ts` | `28bf59c5b9aa3d05592aaedcdc8b2a8c414cdcbb03ea5805f4fa2fbc5cfeb769` |
| `dobius/src/main/telegram-account-mtproto/personal-client.ts` | `94c12cf1815ce58e353fe1da99d59fa5ffb5e7b0821e346c31efb19f591a74a0` |
| `dobius/src/main/ipc/desktop-telegram-account.ts` | `a591afe1ddcaa18fdea8930a293b60d53bf6181396fea7001cb23e9471233546` |
| `dobius/src/main/ipc/telegram-account-trust.ts` | `a41cb23359775fdec26a8c2641b2ca768e72386c9b571f8cf57b92bad26ff929` |
| `dobius/src/main/ipc/telegram-account.ts` | `f1030f598829af9ffd3f97ee49015df2113c39b7c5332c5d10fae1491d8c9571` |
| `dobius/src/shared/telegram-account-api.ts` | `be893a14b3a723ea9cd994c91d1163a55ec27d49411b347ccf5a9f8708faea2e` |
| `dobius/src/shared/telegram-account.ts` | `3e674cae55469b3f9d3141fa768a5637d121aa8153bf20c97a00b01f1068fcfa` |
| `dobius/src/renderer/src/components/settings/TelegramAccountSection.tsx` | `736a1463a0120145a1282ee9614eaa197698b67ccc70939e60e509f5632e32aa` |
| `dobius/src/renderer/src/components/settings/TelegramAccountConnectedPanel.tsx` | `1bad61d5a36f0c4d691c8de55c6abc5549090e471d89046666ee745cbc73cae9` |
| `plans/worker-monitor-20261014/telegram-review/race-probe.test.ts` | `7d611608aa83b7653e6eeebc4d725f5ac9e82d8d0a1f1022c6d072e28d469f97` |

## Remaining gates

Treat this as an early source review, not a final freeze or deployment acceptance. Before any reply/inference path is enabled: implement durable update admission before model dispatch; serialize commits against current state and reject results for deselected groups; define complete participant consent and scoped tool authority; prove real restart-safe MTProto update and send reconciliation; expose reply-active/consent state truthfully; and review the exact production composition and current packaged behavior. No personal Telegram account or live message path was accessed.
