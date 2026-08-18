# gws-mcp: multi-account Google Workspace for Claude Desktop / Claude Code

`scripts/gws-mcp.mjs` is a zero-dependency MCP (stdio) server that exposes the
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

- `gws` CLI installed (`/opt/homebrew/bin/gws`) and logged in at least once.
- Accounts connected in Dobius+ Settings (they live in `~/.gws-profiles`,
  one 0600 file per account, written by the Connect flow).
- node on the machine (the server is a single ESM file, no npm install).

## Register in Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gws": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/bigfuckingdog/Projects (Code)/dobius-plus/scripts/gws-mcp.mjs"]
    }
  }
}
```

Restart Claude Desktop after editing. On another Mac, adjust both paths.

## Register in Claude Code

```bash
claude mcp add gws -- /opt/homebrew/bin/node "/Users/bigfuckingdog/Projects (Code)/dobius-plus/scripts/gws-mcp.mjs"
```

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
Live: speak newline-delimited JSON-RPC to `node scripts/gws-mcp.mjs`
(initialize, tools/list, tools/call), which is exactly what the ship-test in
the v1.0.63 cycle did, including a real per-account Gmail call.
