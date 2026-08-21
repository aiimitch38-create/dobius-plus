# gws-mcp: multi-account Google Workspace for Claude Desktop / Claude Code

`electron/gws-mcp.mjs` is a zero-dependency MCP (stdio) server that exposes the
entire Google Workspace API surface through the `gws` CLI, as ANY Google
account connected in Dobius+. It exists because Claude Desktop's native Gmail
connector is one account at a time, and community Workspace MCP servers
hand-write one tool per operation (a fraction of the APIs, single-account).

## What it can reach

Everything gws can: gmail, drive, sheets, docs, slides, calendar, tasks,
people, chat, classroom, forms, keep, meet, admin-reports, Apps Script, and
any unlisted Google API via a `service:version` first part. Uploads and
binary downloads are deliberately NOT exposed (the server never touches the
local filesystem on the model's behalf).

## Requirements

- `gws` CLI installed (`npm i -g @googleworkspace/cli`).
- Accounts added in Dobius+ Settings via "+ Add Google Account" (browser
  approval, no terminal needed; they live in `~/.gws-profiles`, one 0600
  file per account).
- Nothing else: the Settings button runs the server under Dobius's own binary (no node needed).

## Register in Claude Desktop (the button)

Settings > Google Workspace accounts > **Add to Claude Desktop**. One click:

- copies the bundled server into `<userData>/gws-mcp/` and writes a wrapper
  that runs it under Dobius's own binary with `ELECTRON_RUN_AS_NODE=1`, so
  the Mac needs NO node install;
- merges an `mcpServers.gws` entry into
  `~/Library/Application Support/Claude/claude_desktop_config.json` (same
  per-user path on every Mac). Other servers and hand-written keys survive,
  a timestamped backup is written first, and a malformed existing config is
  refused rather than clobbered;
- re-running is an upsert, so the entry self-heals after app moves/updates.

Restart Claude Desktop after clicking. New-machine recipe (the brother's
house scenario): install Dobius+, install the gws CLI
(`npm i -g @googleworkspace/cli`), add accounts in Settings with
"+ Add Google Account" (all in-app), click Add to Claude Desktop.

### Manual fallback (any MCP client)

The wrapper the button writes is a plain executable; point anything at it:

```json
{ "mcpServers": { "gws": {
    "command": "/Users/<you>/Library/Application Support/dobius-plus/gws-mcp/gws-mcp" } } }
```

## Windows (no Dobius needed)

The server itself is cross-platform: a Windows Claude Desktop user needs
node, the gws CLI, and this one file. Recipe (PowerShell):

```powershell
# 0. gws needs a Google OAuth client (Desktop app type). Get the
#    client_secret.json (share the one from an existing setup, or create one
#    at console.cloud.google.com: APIs & Services > Credentials > Create
#    OAuth client ID > Desktop app) and install it:
#      mkdir $HOME\.config\gws  (if needed)
#      copy client_secret.json $HOME\.config\gws\client_secret.json
#    If the client's consent screen is in Testing mode, the Google account
#    logging in must be listed as a test user on that consent screen.

# 1. Install node from nodejs.org, then the gws CLI:
npm i -g @googleworkspace/cli

# 2. Grab the server (single file, no dependencies):
iwr -OutFile gws-mcp.mjs https://raw.githubusercontent.com/statusdigitalmarketing/dobius-plus/main/electron/gws-mcp.mjs

# 3. Per Google account: log in (opens the browser), then capture it:
gws auth login
node gws-mcp.mjs --capture
# repeat login + --capture for each additional account

# 4. Register in Claude Desktop (%APPDATA%\Claude), then restart it:
node gws-mcp.mjs --setup

# Any time something is off:
node gws-mcp.mjs --doctor
```

`--capture` snapshots the currently-logged-in gws identity into
`~/.gws-profiles` (refreshing in place when the email already has a profile),
`--setup` merges the `mcpServers.gws` entry (same preserve/backup/refuse
semantics as the Mac button), and `--doctor` prints a one-look health report
(node, gws, login identity, captured accounts, config entry). On Windows the
CLI's JS entry runs under the same node as the server (a `.cmd` shim cannot
be exec'd directly), resolved from `%APPDATA%\npm` or the `GWS_MCP_GWS_JS`
override. The three commands work on macOS too.

Caveat: the gws CLI itself on Windows is upstream's territory; the recipe is
unit-tested here but had no live Windows machine to run on. `--doctor` is the
first thing to run if anything misbehaves.

## Register in Claude Code

```bash
claude mcp add gws -- "$HOME/Library/Application Support/dobius-plus/gws-mcp/gws-mcp"
```

(Run the Settings button once first so the wrapper exists. From a dev
checkout you can also run `electron/gws-mcp.mjs` directly under node.)

## Tools

### gws_accounts

No arguments. Lists the connected account emails. Pass one as `account` to
`gws_call`. Calls without `account` run as the base gws identity (whatever
`gws auth login` last set in the terminal).

### gws_call

| field | type | notes |
|---|---|---|
| `command` | string[] (2-5) | positional gws parts, e.g. `["gmail","users","messages","list"]` |
| `account` | string | email from gws_accounts; omit for base identity |
| `params` | object | URL/query parameters (`--params`) |
| `body` | object | request body for POST/PATCH/PUT (`--json`) |
| `apiVersion` | string | e.g. `"v2"` |
| `format` | `json\|table\|yaml\|csv` | default json |
| `pageAll` | boolean | auto-paginate, NDJSON one page per line |

Examples the model can run:

```json
{ "account": "sam@blueatlasbiologics.com",
  "command": ["gmail","users","messages","list"],
  "params": { "userId": "me", "q": "from:stripe.com newer_than:7d", "maxResults": 10 } }
```

```json
{ "account": "admin@axiomscript.com",
  "command": ["calendar","events","list"],
  "params": { "calendarId": "primary", "timeMin": "2026-08-17T00:00:00Z", "maxResults": 20 } }
```

### gws_schema

`{ "method": "drive.files.list" }` returns the API discovery description of a
method (parameters, request/response shapes). The intended flow for anything
unfamiliar: `gws_schema` first, then `gws_call`.

## Security model

- Tokens are minted in-process from the per-account refresh tokens and cached
  in memory until expiry. They are never written, logged, or returned.
- A requested `account` that cannot be resolved or minted FAILS the call. It
  never silently falls back to the base identity (acting as the wrong Google
  account is worse than an error). `invalid_grant` errors say to reconnect
  the account in Dobius+ Settings.
- Positional command parts are allowlisted (`[A-Za-z0-9:._-]`, no leading
  dash), so a tool call cannot smuggle gws flags such as `--upload` or
  `--output` into the argv. `params`/`body` must be JSON objects and are
  stringified by the server itself.
- Output is truncated at 60k chars with a note; use `params.fields` /
  `pageSize` / `q` to narrow, or `pageAll` for deliberate pagination.
- Timeout 60s per call.

## Testing

Unit: `npm run test:gwsmcp` (argv building + smuggle guards).
Live: speak newline-delimited JSON-RPC to the wrapper (or `node electron/gws-mcp.mjs`)
(initialize, tools/list, tools/call), which is exactly what the ship-test in
the v1.0.63 cycle did, including a real per-account Gmail call.
