# Telegram personal account

This guide covers the Telegram **personal account** connection in **Settings → Agents → Telegram personal account**. It is separate from Telegram bot destinations and from the Hermes Adam reasoning account.

## Register a Telegram API application

Create your own Telegram application and keep its API ID and API hash available for sign-in: [Telegram API application instructions](https://core.telegram.org/api/obtaining_api_id). Enter them only in Dobius's Telegram sign-in fields. The fields clear after submission or cancellation; the application credentials are stored by the desktop main process through Electron's encrypted storage, not in renderer settings or browser storage. Never paste them into a terminal, issue, log, or chat.

Telegram's [API Terms](https://core.telegram.org/api/terms) restrict AI use of platform content. The [content licensing terms](https://telegram.org/tos/content-licensing) describe a possible exception requiring individual, explicit, informed and continuing consent for the specific chat and content. Connecting your account does not establish that exception or grant consent for other participants.

## Connect and choose groups

1. Open **Settings → Agents → Telegram personal account**.
2. Enter your phone number with `+` and its country code (for example, `+1` followed by a US number) and, when the app registration is not already configured, your API ID and API hash.
3. Submit the one-time sign-in code and two-step verification password if Telegram asks for them. Dobius clears each submitted secret from the form. Cancel sign-in to stop the pending authorization.
4. After connection, refresh the server-verified group list and select exactly three eligible groups. Direct messages and channels are excluded.

The saved MTProto account session is personal-account authorization, not a bot token. Dobius stores session and pending-send state in an OS-encrypted vault and refuses sign-in when secure storage is unavailable. Do not copy or edit that vault. If encrypted storage fails, stop and use the visible error to recover; Dobius does not log session material or authentication secrets.

## Connection, pause, disconnect, and revoke

- **Connected** means Telegram account authorization is available. It does not mean Adam is receiving events or can reply.
- **Pause replies** stops the account client and persists a paused reconnect choice. After restart, the account remains paused until you explicitly choose **Resume**.
- **Disconnect** removes the local account session and selected group state. It does not claim that Telegram revoked the server-side authorization.
- **Revoke access** asks Telegram to revoke the personal account authorization. If the account is paused, the desktop composition may authenticate a connection for the revoke operation; it does not enable reply processing for that step. Treat an error or uncertain result as unconfirmed, and do not describe the account as remotely revoked until the operation succeeds.

## Enable Adam for selected participants

The personal-account route does not add a bot or a new member to your groups. Dobius receives eligible new events through your connected account and passes authorized text to the existing **Adam Hermes profile** for a proposed reply. Dobius owns the final Telegram send.

1. Save exactly three verified groups. Under participant permissions, refresh a group's participant list. Telegram may restrict member visibility; the current fetch is bounded to 200 participants per group. Only verified human accounts returned by Telegram can be granted permission here.
2. For each participant whose messages Adam may process, record their explicit informed permission for this specific chat and purpose, including evidence and an expiration. The evidence field records an actual permission already obtained; it does not obtain permission or prove consent by itself. No group-wide checkbox authorizes everyone.
3. Choose **Connect Adam and start listening**. The account must be connected and unpaused, the three groups saved, and at least one current participant permission present. Only messages from individually permitted senders are eligible.
4. Send an authorized new test message in a selected group. A successful inference appears as a draft. Review it, choose **Approve**, then choose **Send** separately. Replies are always approval-required.

Permission is bound to account, group, participant and purpose, and stored in a separate OS-encrypted `consents.enc` vault. Expiration, withdrawal, changed selection or account identity blocks processing and delivery. Permission is rechecked after inference, at approval and immediately before the remote send. Revoking a permission stops active inference even when saving the revocation fails; a save error means the durable withdrawal must still be completed before restarting.

**Stop listening** cancels inference while preserving the Telegram login. **Pause replies** also stops the account connection and persists pause across app restart. Restarting Dobius may restore a previously enabled Telegram account, but does not automatically start Adam listening; connect Adam explicitly again.

## Adam runtime and isolation

Dobius main launches the installed Hermes virtualenv Python with the packaged `adam-telegram/bridge_runner.py` and Adam's existing profile under `~/.hermes/profiles/adam`. Main owns a private inherited duplex FD3 and verifies a fresh nonce, exact child identity and the enforced `no-tools` policy before readiness. No public listener, terminal injection, credential copy or Telegram session export is used.

This uses the same Adam identity, configuration, provider account and profile context, with separate conversations for each group/participant. It does not attach to or change the open Adam TUI conversation. Gateway conversations and receipts live in Adam's private `dobius-telegram-bridge/` directory; the TUI database is not maintained or pruned. Friday and unrelated platforms remain untouched.

Incoming chat text is quoted as untrusted content. A host-enforced policy removes all model tools and rejects execution, delegation, plugin/MCP injection and opaque native-tool modes for this ingress. This gateway drafts replies; it does not grant Telegram participants control of Dobius or Adam's other tools.

The maintained generic Hermes policy patch and manifest are packaged alongside the adapter. Readiness verifies the exact reviewed Hermes Git revision, enforcement-file hashes and patch digest before imports and each model turn. A Hermes update or partial policy change disables the bridge until the patch is reviewed/rebased, tests pass and a new manifest is packaged. Do not bypass a failed policy check by editing hashes. Adapter maintenance and deterministic test commands are documented in `resources/adam-telegram/README.md`.

The inherited transport currently supports macOS and Linux. Native Windows fails closed; no unauthenticated network fallback is enabled. An existing gateway holding Adam's profile runtime lock also prevents a second gateway from starting.

## Delivery, limits and recovery

Only new events received while listening are processed. This implementation does not scrape chat history or claim to recover every message received while the app was stopped, disconnected or paused.

Admission is encrypted and persisted before inference. The child additionally persists request identities and terminal receipts, preventing duplicate model calls on repeated admission. There are at most 32 outstanding requests and two concurrent model calls, with serial conversations per group/participant. The five-minute overall deadline includes queue wait. Overflow, timeout, interrupted inference and uncertain completion require manual review; the system does not automatically replay uncertain requests.

The **Incoming messages needing review** list shows affected group/message identities. Inspect the original message in Telegram; there is deliberately no blind retry button. A crash during processing becomes manual review after restart. Successful drafts and outgoing random IDs are persisted separately. Uncertain remote sends remain visibly unknown; do not retry blindly because Telegram does not generally provide a query for an arbitrary prior `random_id` send.

## Sign-in troubleshooting

The form removes spaces, parentheses and hyphens from the phone number before submission and requires a country code. It clears submitted credentials even when sign-in fails. Use the visible error to distinguish invalid details, unavailable secure storage, authorization failure and state-save failure; raw Telegram exceptions are never displayed. If reopening settings shows **Needs attention** with a saved account, choose **Retry saved connection** first; this preserves the saved login and selected groups. Use **Restart sign-in** to return to phone entry when a fresh authorization is actually needed. The SDK session must finish loading its saved authentication key before the app validates or connects it; a restore failure alone does not mean a newly entered code or password was wrong. A connected account still needs participant permissions and an explicit Adam listener startup before replies can be drafted.

## Source map and focused check

- Renderer account UI and transient sign-in form: `src/renderer/src/components/settings/TelegramAccount*.tsx`.
- Public account view and typed renderer API: `src/shared/telegram-account.ts` and `src/shared/telegram-account-api.ts`.
- Desktop API composition and IPC/preload: `src/main/ipc/desktop-telegram-account.ts`, the Telegram account IPC module, and `src/preload/telegram-account.ts`.
- Authorization, pause/reconnect, group selection, consent checks, and drafts: `src/main/telegram-account/`.
- MTProto client and session conversion: `src/main/telegram-account-mtproto/` (installed SDK is `teleproto@1.230.0`, which uses `big-integer`).

With Node 24 active, run the focused synthetic renderer test from the `dobius/` directory:

```sh
pnpm exec vitest run \
  --config config/vitest.config.ts \
  src/renderer/src/components/settings/TelegramAccountSection.test.tsx \
  --maxWorkers=1 --reporter=dot
```

## Readiness gates

Source tests and a successful startup handshake are separate from live acceptance. Verify the packaged assets and enforced policy, then use a specifically authorized new incoming message to confirm a visible draft, approval and delivery. Also check Stop, permission withdrawal and restart/manual-review behavior. Account connection alone is not proof that Adam is listening, and a startup handshake is not proof of a completed Telegram reply.
