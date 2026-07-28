# Plan: connect multiple Google Workspace (gws) accounts

Status: DRAFT for review. No code written yet. Requested by Sam 2026-07-28.

## What Sam asked for

"Have the option to connect multiple gws accounts", with three uses (Sam picked
all three):

1. **Per-tab Google identity** so `gws` in one tab runs as account A and another
   tab as account B.
2. **In-app Gmail / Calendar / Drive view** across multiple connected accounts.
3. **Voice / Jarvis sends mail** as a chosen connected account.

## What I verified first (so the plan is grounded, not guessed)

Tested against Sam's real gws install, read-only:

- gws supports per-invocation identity via two env vars:
  `GOOGLE_WORKSPACE_CLI_TOKEN` (a short-lived access token, highest priority) and
  `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` (a path).
- **The easy path is dead.** Feeding `gws auth export`'s output
  (`{client_id, client_secret, refresh_token, type}`) through
  `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` returns
  `401 invalid_client: The provided client secret is invalid`. So the
  file-snapshot approach that mirrors the existing Claude-account flow does not
  work for gws.
- **The viable path** is: store each account's **refresh token**, mint a
  short-lived **access token** on demand (standard Google OAuth refresh grant),
  cache it with its expiry, and inject `GOOGLE_WORKSPACE_CLI_TOKEN` per call /
  per tab. This is the foundation all three features sit on.
- `GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file` is **forbidden** (global rule: it
  broke Sam's gws auth on 2026-06-01, reverted 2026-06-04). The token path does
  not touch the keyring backend, so it stays clear of that landmine.

## Decisions locked (from Sam)

- **Token storage:** per-account files at `~/.gws-profiles/<id>.json`, mode
  `0600`. Never in `config.json`. Mirrors the existing `~/.claude-profiles/`
  pattern. `config.json` stores only the account's `id`, `name`, `email`, and
  the profile file PATH, never the refresh token itself.
- **Sequencing:** this doc first, then build.

## Architecture

### One foundation, three thin features

```
                         ~/.gws-profiles/<id>.json   (0600: refresh_token + client)
                                    |
                    electron/gws-accounts.js  (NEW)
                    - connect (snapshot from `gws auth export`)
                    - mint + cache access token (OAuth refresh grant)
                    - list / remove
                                    |
        +---------------------------+-----------------------------+
        |                           |                             |
  Feature 1                    Feature 2                     Feature 3
  per-tab identity          in-app Gmail/Cal/Drive        voice sends mail
  (env injection)           (dashboard tab)               (voice-conductor tool)
```

The foundation IS "the option to connect multiple gws accounts". Features 1/2/3
are what you do with a connected account, and each just asks the foundation for a
fresh access token for account X.

### How "connect an account" works (reuses gws, no new OAuth app)

Same snapshot UX Dobius already uses for Claude accounts:

1. In a terminal, Sam runs `gws auth login` (browser consent) for the account he
   wants, or is already logged into it.
2. In Dobius > Settings > Accounts, he clicks **Connect Google Account**.
3. Dobius runs `gws auth export`, reads `{client_id, client_secret,
   refresh_token}`, and also reads the real OAuth client from
   `~/.config/gws/client_secret.json` (the `installed` block). It writes a
   `0600` profile file combining the refresh token with a working client, and
   records the account (id, name, email) in config.
4. To add a second account: `gws auth logout`, `gws auth login` as the other
   account, click Connect again. (Identical to the documented Claude flow.)

> Build-time check before shipping the connect flow: confirm which client
> (`client_secret.json`'s `installed` client, or export's own client) actually
> mints a token via the refresh grant. The export client_secret was rejected in
> a raw CREDENTIALS_FILE test; the refresh-grant mint is a separate call and
> must be proven live (redacted) before the UI is wired. This is the one
> remaining third-party-contract unknown.

### Token minting (the core of `gws-accounts.js`)

```
getAccessToken(accountId):
  prof = read ~/.gws-profiles/<id>.json
  if cached[id] and cached[id].expiresAt - now > 60s: return cached[id].token
  POST https://oauth2.googleapis.com/token
       grant_type=refresh_token, client_id, client_secret, refresh_token
  -> { access_token, expires_in }
  cached[id] = { token, expiresAt: now + expires_in*1000 }
  return access_token
```

In-memory cache only (tokens live ~1h). No token on disk, only the refresh
token in the `0600` profile.

## Feature 1: per-tab Google identity

Current model binds accounts **per project**, not per tab: `main.js` builds
`accountEnv` from `getProjectAccount(cwd)` and passes it to `createTerminal`
(`terminal-manager.js:70`, injects `OPENAI_API_KEY` / `CLAUDE_CONFIG_DIR` /
`DOBIUS_CLI_DIR`). Two options, and this is the one open design question for
Sam:

- **1a (smaller):** bind a Google account **per project**, like Claude/Codex
  today. `gws` in any tab of that project runs as that account. Reuses the exact
  existing path.
- **1b (what Sam literally asked):** bind **per tab**. Needs a tab -> account
  map and a way to pick an account per tab (tab context menu). More UI, and the
  access token has ~1h life so the terminal env would need refreshing, which env
  vars cannot do after spawn.

The env-injection problem for per-tab: `GOOGLE_WORKSPACE_CLI_TOKEN` is set at
spawn and goes stale in ~1h. Cleaner mechanism: install a tiny `gws` shim on the
per-tab `PATH` that calls back to Dobius for a fresh token before exec'ing the
real gws. That is the honest cost of "per-tab identity" and should be its own
sub-phase.

Recommendation: ship **1a (per-project)** first (near-free, reuses everything),
then evaluate whether 1b's per-tab shim is worth it.

## Feature 2: in-app Gmail / Calendar / Drive view (the big one)

A new dashboard tab. For the selected connected account, Dobius calls the Google
APIs directly with a minted access token (or shells `gws gmail/calendar/drive`
with `GOOGLE_WORKSPACE_CLI_TOKEN`), parses JSON, and renders:

- Account switcher (the connected accounts).
- Gmail: message list + read pane (read-only first).
- Calendar: upcoming events.
- Drive: recent files.

This is the multi-week part: it is a whole read UI with pagination, threading,
and per-account switching. Ships as its own phase after the foundation.

## Feature 3: voice / Jarvis sends mail

Small once the foundation exists. Add a `gws-send-mail` tool to the voice
conductor / voice-bridge that takes `{accountId, to, subject, body}`, mints the
token, and sends via `gws gmail ... send` (or the Gmail API). Reuses the
existing global soft-wrap rule for the body. Confirmation gate before an actual
send, consistent with the iMessage-bridge spawn gates.

## Files

**New**
| File | Purpose |
|---|---|
| `electron/gws-accounts.js` | connect, list, remove, `getAccessToken` (mint+cache). |
| `~/.gws-profiles/<id>.json` | 0600 per-account refresh token + client (runtime, not repo). |
| `src/components/Dashboard/GoogleView.jsx` | Feature 2 dashboard tab (phase 2). |

**Modified**
| File | Change |
|---|---|
| `electron/config-manager.js` | `google` account type; profile-path validation under `~/.gws-profiles` (mirror the `~/.claude-profiles` guard at line 924); CRUD. |
| `electron/main.js` | IPC: `gws:connect`, `gws:list`, `gws:remove`, `gws:getToken`; extend `accountEnv` (feature 1a) to inject a minted `GOOGLE_WORKSPACE_CLI_TOKEN`. |
| `electron/preload.js` | Bridge the new IPC. |
| `src/components/Dashboard/AccountsSection.jsx` | `google` account type in the add/list UI + Connect Google Account button. |
| `electron/voice-bridge.js` / `voice-conductor.js` | Feature 3 send-mail tool (phase 3). |

## Security posture

- Refresh token only ever in `~/.gws-profiles/<id>.json` at `0600`, never in
  `config.json`, never logged, never in a thrown message.
- Path validation: profile files must resolve under `~/.gws-profiles/` (realpath
  check), same guard as `accountsSave` uses for `~/.claude-profiles/`.
- Access tokens: in-memory only, ~1h life, refreshed on demand.
- No keyring-backend change (global rule).
- Feature 3 send is gated behind an explicit confirmation before any real send.
- Connect flow shells `gws auth export` (read-only) via `execFile` with no shell
  interpolation; account name/email validated before being written to config.

## Phases

1. **Foundation** (`gws-accounts.js` + config type + IPC + AccountsSection
   Connect UI + token mint/refresh). Deliverable: connect 2+ Google accounts,
   see them listed. Prove the refresh-grant mint live (redacted) as step 1.
2. **Feature 1a** per-project Google identity (env injection). Small.
3. **Feature 3** voice send-mail tool. Small.
4. **Feature 2** in-app Gmail/Calendar/Drive dashboard. Large, its own effort.
5. (Optional) **Feature 1b** per-tab identity via a gws shim, if 1a is not
   enough.

Each phase goes through the standard Codex review + build + ship-test gate, and
nothing is auto-shipped without Sam's go (local-first rule).

## Open question for Sam (only one)

Feature 1 identity scope: **1a per-project** (near-free, reuses the existing
account-binding path, `gws` in a project's tabs runs as that project's Google
account) vs **1b per-tab** (what you literally said, needs a per-tab picker and a
gws shim to keep the ~1h token fresh). Recommendation: 1a first, add 1b later
only if per-project is not enough.

## What this plan does NOT do

- No new Google Cloud OAuth app (reuses gws's existing client).
- No keyring-backend change.
- No write/delete Google operations in phase 2 (read-only first; sending is
  phase 3 and gated).
