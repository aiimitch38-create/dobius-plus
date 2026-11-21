# Gmail intake (plan item 8.18): research and design

Status: research only. No app code was changed.
Branch: wb/plan2-research. Plan source: plans/WORKSTATION-BUILD-PLAN.md, "Plan: Gmail intake (8.18)".

Key terms, in plain English:
- **OAuth** (the "Sign in with Google" permission flow): the way an app gets permission to read one Google account without knowing its password.
- **Scope** (a permission level inside OAuth): `gmail.readonly` lets an app read mail; it cannot send or change it.
- **Watermark** (a saved bookmark): the last item already handled, so the next check starts after it.
- **Dedupe** (duplicate check): making sure the same email never makes two cards.
- **Kanban card** (a task on the board): one item in the Dobius task board, stored in `vertex-tasks.json`.

## Summary

Gmail intake is possible, and most of the plumbing already exists. Three things are missing: a Gmail client that runs inside the app, a "tracked contacts" list (none exists in the code), and a dedupe key on cards (cards have no message id today). The recommended path is a new read-only Gmail client in the app's main process, with its own sign-in, and a suggestion-first flow where Carson approves each card.

## Findings

### 1. Auth: which path

**Verified: the Google Workspace MCP is connected, but it cannot run a background poller.**
- `~/.claude.json` registers a `google-workspace` MCP (a connector that Claude sessions can call) that runs `workspace-mcp` with `--tools gmail calendar drive docs sheets` (line 7517 onward; secrets not printed).
- An MCP only works inside a Claude session. A poller in the app's main process cannot call it. Polling through an agent would spend tokens on every check, and results would vary from run to run.
- Verdict: good for ad hoc reading, not for intake.

**Verified: the file the old plan relied on does not exist.**
- `plans/algorithm/TASK-2-gmail-read-source.md` says the Manager reads `google-workspace-credentials.ts` and `~/.google_workspace_mcp/credentials/`. No file named `google-workspace-credentials*` exists anywhere under `~/Projects (Code)/dobius-plus`, and nothing in `dobius/src` references `google_workspace_mcp`. Treat that TASK-2 assumption as stale.

**Verified: the MCP's token store exists and holds two accounts.**
- `~/.google_workspace_mcp/credentials/` has per-account files (names are emails, not printed here) plus `client_secret.json` (mode 600).
- Reusing that store would mean one app reading another tool's secret files. Not recommended.

**Verified: Line A's multi-account gws plan is a draft.**
- `Research/GWS-MULTI-ACCOUNT-PLAN.md` (Status: DRAFT, requested by Sam 2026-07-28). Its own finding: the simple credentials-file path fails with `invalid_client`. The viable path is refresh tokens stored per account. This is not built.
- Verdict: depends on Sam's gws install and an unbuilt token layer. Not a v1 base.

**Verified: the app already has a secret-storage pattern.**
- `dobius/src/main/telegram-account/vault.ts:32-48` uses Electron's `safeStorage` (OS-level encryption for secrets) with `encryptString` / `decryptString`. A Gmail refresh token can use the same pattern.

**Recommendation: a new main-process Gmail client, read-only.**
- Own sign-in with scope `https://www.googleapis.com/auth/gmail.readonly`.
- Refresh token stored with the `safeStorage` pattern above.
- Use the Gmail REST API (`users.history.list` and `users.messages.get`) from the main process.
- Do not reuse the MCP's token files.

### 2. Where cards land

**Verified: the card store and its IPC.**
- Cards are stored in `vertex-tasks.json` under the app data folder (`main/vertex/vertex-task-store.ts:35`, `:52`).
- `vertexTaskStore.create(input)` is at `vertex-task-store.ts:202`. The IPC handler `vertexTasks:create` is at `main/ipc/vertex-tasks.ts:41-55`.
- Types: `VertexTaskInput` (`shared/vertex-task-types.ts:316`), `VertexTaskSourceOrigin` already includes `'gmail'` (`:233`), and `VertexTaskSourceQuote` (`:237`) holds the original text with a comment that it is UNTRUSTED DATA (`:236`).
- The runtime RPC and CLI already accept `origin: 'gmail'` (`main/runtime/rpc/methods/tasks.ts:55`, `cli/handlers/tasks.ts:243`). So the card path exists; no new store is needed.

**Verified: the card has no dedupe key.**
- `create()` (`vertex-task-store.ts:202-220`) reads all cards, appends one, and saves. It does not check for an existing card. `sourceQuote` stores text and sender only. No Gmail message id is saved.
- Verdict: add a `sourceRef` (for example `gmail:<messageId>`) and check it before creating.

**Verified: origin `kind` is `'user' | 'agent' | 'manual'`** (`vertex-task-types.ts:253-258`). Gmail cards should use `kind: 'agent'` with a note `gmail-intake`, or add a new kind. Pick one (see questions).

### 3. "Tracked contacts"

**Verified: the concept does not exist in code.**
- A case-insensitive search for "tracked contact" / `trackedContacts` in `dobius/src` returns nothing.
- The iMessage bridge has only `selfHandle` (one phone or email) and a trigger prefix (`main/imessage-bridge/bridge-config.ts`). It has no list of other people.

**Inferred from the memory note `proactive-dobius-decisions`:** Carson wants a Settings list of people (clients, bosses) whose messages become cards. That note says iMessage, Gmail and Telegram all use this list. The memory note is a decision record, not code.

**Recommendation:** one Settings list of email addresses (exact match on the `From` address), stored in the app's config. Copy the record shape from `bridge-config.ts:20`, `:58`, `:124-153` (normalize on read, write through one update function).

### 4. Poller pattern (copy the iMessage bridge)

**Verified: the iMessage bridge already has the two rules Gmail needs.**
- Watermark jump on start: `main/imessage-bridge/bridge-service.ts:115-124` moves the bookmark to the newest row on every start, so old mail never becomes cards by surprise.
- At-most-once: `bridge-service.ts:228-231` saves the bookmark before handling each message, so a crash never handles the same message twice.
- Poll interval: 2 seconds (`:36`). For Gmail, use 2 minutes or more; Gmail has rate limits.

**Recommendation:** store the Gmail `historyId` as the watermark. Gmail's history list returns only what changed after that id.

### 5. Classifier

**Verified:** `main/agents/agent-channel-service.ts` already routes channel messages to agents, but it is for chat replies, not extraction.
**Verified:** Laya (the advisory model service) is not active. The memory note says it needs activation or a Sonnet fallback.
**Recommendation:** a small classifier call that returns `{ isTask, title, priority }` as a suggestion. It never sends anything. The model choice is a question for Carson.

### 6. Safety

- **Read-only:** scope `gmail.readonly`. No send, no reply, no label change. The old decision log (`plans/algorithm/DECISIONS.md:12`, 2026-07-12) killed "send email from the Manager tab", so this matches.
- **Prompt injection:** an email is data, never an instruction. Existing rule: `sourceQuote` is UNTRUSTED (`vertex-task-types.ts:236`). The classifier prompt must put the email body in a clearly marked data block, and the card must not auto-run any agent.
- **Dedupe:** by Gmail message id, enforced in `create()` (see section 2).
- **Suggestions first:** cards land in a "suggested" state (or a Backlog column) and Carson approves before any agent works on them. Check the existing column list in `VERTEX_TASK_STATUSES` (`vertex-task-types.ts:41`) before choosing.

### 7. Conflict to resolve first

**Verified: two decision records disagree.**
- `plans/algorithm/DECISIONS.md:80` (2026-11-21): "8.3 Gmail intake ... KILL for now ... Carson asks."
- `plans/WORKSTATION-BUILD-PLAN.md` Phase 8 (2026-11-21): Carson said "just add everything", and lists 8.18 as "yes".
Carson needs to say which one stands. This research assumes the Phase 8 decision.

## Recommended design (one path)

1. Settings: tracked sender list plus an on/off switch. Stored like `bridge-config.ts`.
2. Sign-in: a new Gmail OAuth flow with `gmail.readonly`. Refresh token in `safeStorage`.
3. Poller: every 2 minutes, `users.history.list` from the saved `historyId`, then `users.messages.get` for matching senders only. Save the new `historyId` before handling each message (at-most-once).
4. Dedupe: skip any message whose `gmail:<id>` already exists on a card.
5. Classify: one call that returns a suggested title, priority and yes/no. Body is passed as quoted data.
6. Card: `vertexTaskStore.create` with `origin` (agent, note `gmail-intake`), `sourceQuote` (origin `gmail`, sender, text), and a link to the thread (`https://mail.google.com/mail/u/0/#inbox/<threadId>`).
7. Carson approves the card; nothing runs before that.

## Task list

| # | Task | Files | Size |
|---|---|---|---|
| G1 | Tracked-sender list in Settings and config | new `main/gmail/gmail-config.ts` (copy shape of `main/imessage-bridge/bridge-config.ts`); Settings pane (location not checked) | S |
| G2 | Gmail sign-in (OAuth, `gmail.readonly`) and encrypted refresh token | new `main/gmail/gmail-auth.ts`, `main/gmail/gmail-token-store.ts` (copy `main/telegram-account/vault.ts:32-48`) | M |
| G3 | Read-only Gmail client (history list, message get) with fake client for tests | new `main/gmail/gmail-client.ts`; tests next to it | M |
| G4 | Poller with `historyId` watermark, at-most-once (copy bridge pattern) | new `main/gmail/gmail-poller.ts`, modeled on `main/imessage-bridge/bridge-service.ts:85-132, 218-235` | M |
| G5 | Dedupe key on cards (`sourceRef`), checked in `create()` | `main/vertex/vertex-task-store.ts:202`, `shared/vertex-task-types.ts:237` | S |
| G6 | Classifier (suggestion only, quoted-data prompt) | new `main/gmail/gmail-classify.ts`; model choice pending | M |
| G7 | Card creation through the existing IPC path | `main/ipc/vertex-tasks.ts:41-55` (reuse, no change expected) | S |
| G8 | Tests: dedupe, watermark never moves backward, injection text stays data, no send call exists | new `main/gmail/*.test.ts` | M |
| G9 | Live check: one real test thread from a tracked sender becomes one card, once | manual | S |

Total: about 2 M-size tasks plus 3 S, roughly 3 to 5 days.

## Open questions for Carson

1. Phase 8 says "add everything" and `DECISIONS.md` says "KILL for now" for the same item on the same day. Which stands?
2. Which Gmail account(s) does intake read? Only aiimitch38@gmail.com (the one the MCP is connected to), or the multi-account set from Line A?
3. Who runs the classifier: Laya once activated, or a Sonnet call? (Model choice has cost.)
4. Should Gmail cards use the existing `origin.kind = 'agent'`, or should we add a `'intake'` kind?
5. Is "tracked" only exact email addresses, or also whole domains (for example every `@clientcompany.com`)?
6. Confirm: no send or reply from intake, ever, including later.
