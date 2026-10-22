# Telegram final exact-source review

**Task / dispatch:** `task_8795aea9eb1c` / `ctx_af1dfe50289b`  
**Reviewer handle:** `term_d892e988-92d2-4eeb-9694-89e5853a18f9`  
**Coordinator:** `term_2958d5fd-ff36-4ae7-9f23-6ed32a748f54`  
**Repository / branch:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, `fix/channel-cost`  
**Verdict:** `CHANGES_REQUIRED` for the account-control source packet; the two previously reproduced inbound races are corrected in the reviewed freeze.

## Freeze verification

I verified the 53 listed source paths against `plans/worker-monitor-20261014/ROOT-telegram-source-freeze-20261016.json` before and after review. The manifest SHA-256 is `d6d16d46c8c796c51bfbf243d5efdc5fae53c598fc758ed0676c1e799fe8f7ff`; all 53 path hashes and byte counts matched both times. No frozen source file changed during review. The disposable probe is `plans/worker-monitor-20261014/telegram-final-review/final-race-probe.test.ts` (SHA-256 `18da2e2bb6293aa2d5071011235dc66d2029633bde5c84cc35b1d383700a4898`, 4,883 bytes); it is an independent review artifact, not product source.

## Confirmed race corrections

1. **Duplicate callback, replay, and pruned draft:** `TelegramIncomingMessageProcessor.reserve` checks the `(accountId, groupId, messageId)` receipt and persists a `processing` receipt through the vault before invoking `replyToAdam` (`dobius/src/main/telegram-account/incoming-message.ts:64-79,96-157`). The callback’s short-lived in-memory set supplements the durable identity ledger; it is not the only dedupe mechanism. The v2 vault bounds that ledger at 10,000 entries, refuses admission before inference at the limit, and migrates v1 state while retaining identities represented by existing drafts (`types.ts:30-43`, `vault.ts:108-143,184-198`). A crash-left `processing` receipt becomes `manual-review` on restore and is not reinferred (`recover-state.ts:3-21`).

   The author regression covers concurrent duplicate callbacks, replay after restart, crash-left processing, and capacity refusal. My additional disposable probe created 101 drafts to force the first out of the 100-draft display window, restarted against the same vault, then replayed the pruned message; the ledger remained at 101 receipts and the replay callback was not invoked.

2. **Stale whole-state publication and selection ABA:** Publication reads the latest vault state, validates account/generation, selected group identity, consent revision and the monotonic selection epoch, then merges the draft and receipt into that current state (`incoming-message.ts:169-231`; selection epoch increments only after a verified selection is saved in `connection.ts:157-195`, and is exposed by `service.ts:30-31,94-95`). A deselected-then-reselected group therefore cannot make an old inference result current again. My probe resolved two distinct deferred replies in reverse order and observed both drafts preserved, then changed and restored the selection before resolving a third reply; it produced no stale draft and retained the current saved selection. The frozen author test independently covers the ABA case.

## Changes required

**Paused revoke in the same running process does not reach Telegram’s logout method.** `pause()` sets the service’s private paused flag (`connection.ts:202-206`), while `isCurrent` requires `!paused` (`service.ts:263-265`). `restore()` begins a new generation but does not clear that flag before awaiting `client.connect`; it checks `isCurrent` at `connection.ts:127-134`, and only clears pause after that check at line 144. In the desktop API, `revoke()` detects a paused account and calls `service.restore()` directly (`dobius/src/main/ipc/desktop-telegram-account.ts:160-178`). Thus, after pausing and selecting **Revoke access** without restarting the app, restoration connects and then returns `stale-operation`; the wrapper never reaches `service.revoke()` / `revokeAuthorization()`. The UI exposes Revoke access for both connected and paused states (`TelegramAccountSection.tsx:174-210`).

The existing regression at `dobius/src/main/ipc/desktop-telegram-account.test.ts:136-145` only tests pause, construct a **new** API after restart, and revoke. That new service begins with `paused=false`, so it does not exercise the same-process path. My synthetic service-level probe reproduced the gating behavior: after `restore(); pause(); restore()`, restore returns `{ok:false,error:'stale-operation'}`, and `revoke()` returns `client-unavailable` without calling the fake `revokeAuthorization`. The wrapper also writes reconnect preference `disconnected` before awaiting the revoke result (`desktop-telegram-account.ts:175-178`), so a failed attempt changes the persisted choice even though remote logout was not confirmed.

**Smallest correction:** have the paused desktop revoke path use an explicit reconnect-for-revocation operation that clears the internal pause before restore, while never subscribing to updates or starting reply handling. Preserve the user’s paused reconnect preference unless typed remote logout succeeds; test same-process pause→revoke, post-restart pause→revoke, failed logout retaining a paused state, and no subscription/inference in either path. This is a remote authorization-control defect, not evidence that any live account was touched.

## Source-only scope and remaining gates

- The two requested inbound races are closed at the reviewed source point, but the overall verdict remains `CHANGES_REQUIRED` because of the paused-revoke path above.
- `createDesktopTelegramAccountApi` deliberately passes `replyToAdam: null` and `readConsent: null` (`desktop-telegram-account.ts:37-46`); the connected UI says chat consent is pending and keeps approval/send controls disabled (`TelegramAccountConnectedPanel.tsx:135-220`). This is an account-connection source review, not Adam gateway integration, participant-consent proof, or live reply acceptance.
- Consent is currently a main-owned sender-level `{allowed, revision}` proof; it does not establish complete group participant consent (`types.ts:45-50`). Keep the null production wiring until a separate reviewed, group-scoped consent and Adam gateway exists.
- The inbound ledger intentionally refuses new inference after 10,000 retained identities; this is bounded fail-closed behavior with no compaction/reset path in this packet. Legacy v1 can preserve only identities represented in its retained drafts; it cannot reconstruct older updates already pruned before migration.
- The Teleproto adapter uses a typed `auth.LoggedOut` result for revoke. Its random-ID lookup is process-memory-only; uncertain sends remain manual review after a restart rather than being blindly resent. Adapter and account tests are synthetic. No personal account, login, message, provider, device, OS keychain, service, gateway, or consent state was accessed.
- ROOT’s recorded 84-test and Node/CLI/web typecheck runs are attributed to ROOT; the focused test run below was independently executed by this reviewer. No build, install, service action, Git mutation, or unrelated task was performed.

## Validation evidence

Independent focused suite, explicit Node 24, exit 0: 10 test files, 84 tests.

```sh
cd "/Users/bayou/Projects (Code)/Dobius/dobius-plus/dobius"
PATH="/Users/bayou/homebrew/opt/node@24/bin:$PATH" ./node_modules/.bin/vitest run --config config/vitest.config.ts src/main/telegram-account src/main/telegram-account-mtproto src/main/ipc/desktop-telegram-account.test.ts src/main/ipc/telegram-account src/main/ipc/register-core-handlers.test.ts src/renderer/src/components/settings/TelegramAccountSection.test.tsx --maxWorkers=1
```

Independent disposable race probe, explicit Node 24, exit 0: 1 test file, 3 tests. This covered the pruned-ledger replay, reverse-order current-state merge plus selection ABA, and the paused-service restore refusal described above.

```sh
cd "/Users/bayou/Projects (Code)/Dobius/dobius-plus/dobius"
PATH="/Users/bayou/homebrew/opt/node@24/bin:$PATH" ./node_modules/.bin/vitest run --config /private/tmp/telegram-final-review-vitest.config.cjs --maxWorkers=1
```

The probe config is outside the repository at `/private/tmp/telegram-final-review-vitest.config.cjs`; its include is limited to the review-only probe. Initial probe iterations exposed harness timeout/field-assumption errors; the corrected final probe run is the reported 3/3 result. A direct desktop-wrapper reproduction was not relied on because its temporary Electron mock did not load; the same-process defect is supported by the service-level synthetic reproduction and the reviewed wrapper/service control flow. No independent Node/CLI/web typecheck was run; ROOT reports those PASS for this freeze.
