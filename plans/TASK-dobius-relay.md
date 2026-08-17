# TASK: Build the Dobius relay (port 3300)

## What

Write the missing server half of Dobius Communications: a local Nostr relay on
port 3300 serving both an HTTP query/submit API and a NIP-01 WebSocket.

## Why

Buzz is a Nostr client. It is not pointed at any public relay — the Dobius shim
hardcodes our own:

```ts
// vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts:195-196
const DOBIUS_RELAY_WEBSOCKET_URL = "ws://localhost:3300";
const DOBIUS_RELAY_HTTP_URL = "http://localhost:3300";
```

The entire client half exists. **The server was never written.** Verified:

- `lsof -nP -iTCP:3300` → nothing listening; `curl` → connection refused
- No `/query` or `/events` handler anywhere in the repo
- Only clients exist: `src/renderer/src/components/buzz/native/relay-client.ts`,
  `vendor/buzz-desktop/src/shared/api/relayClientSession.ts`

That is the direct cause of both errors on screen: the WebSocket connect fails
→ "Can't reach the relay"; the HTTP fetches fail → "Failed to fetch" /
"Home feed unavailable".

Related but separate: only 54 of 258 Tauri commands are shimmed
(`src/main/communications/command-manifest.json`: 180 pending, 24
removed-pending). The relay unblocks the feed and connection card; it does not
by itself implement the 180 pending commands.

## Scope decision (assumed — confirm before build)

Planning for **local-only, 127.0.0.1**. It matches the hardcoded URLs, needs no
auth model, and exposes nothing to the network. Extending to the gaming PC over
Tailscale later means: make the two URL constants configurable, bind the
Tailscale interface, and add NIP-42 auth so it is not an open relay on the
tailnet. That is a follow-up, not this task.

## Contract (fixed by the existing client — not our choice)

| Surface | Request | Response |
|---|---|---|
| `POST /query` | JSON array of Nostr filters; header `X-Pubkey` | JSON array of `{id, pubkey, created_at, kind, tags, content}` |
| `POST /events` | Serialized signed event JSON; header `X-Pubkey` | `{accepted?, event_id?, message?}` |
| `ws://localhost:3300` | NIP-01 frames | `REQ` → `EVENT`* → `EOSE`; `CLOSE`; `EVENT` → `OK` |

Non-2xx bodies are surfaced verbatim as the thrown error message
(`relay-client.ts:43-60`), so error text must stay human-readable.

**Filter keys actually used** (audited across both clients — support exactly
these, reject nothing else silently): `ids`, `authors`, `kinds`, `since`,
`limit`, and tag filters `#d`, `#p`, `#h`, `#e`.

**Event kinds in use:** 0 (profile), 1 (note), 7 (reaction), 9 (chat message),
30622, 39000 / 39002 (channel metadata), 40002, 41010, 45001, 45003.

Replaceable-kind semantics matter: kind 0 and the 30000–39999 addressable
range must keep only the newest event per `(pubkey, kind, #d)`. The client
already re-sorts by `created_at` defensively, but storing every revision
forever will bloat the DB and skew `limit`.

## Files

| File | Purpose |
|---|---|
| `src/main/communications/relay/relay-store.ts` | `node:sqlite` event store — insert, replaceable-kind collapse, filter→SQL |
| `src/main/communications/relay/relay-filters.ts` | Pure filter matching (shared by HTTP query and live WS subscriptions) |
| `src/main/communications/relay/relay-server.ts` | HTTP + WS server on 3300, request validation, subscription fanout |
| `src/main/communications/relay/relay-event.ts` | Event shape validation + schnorr signature verify |
| `*.test.ts` alongside each | Unit tests |

Storage mirrors `src/main/runtime/orchestration/db.ts` (the project's
`SyncDatabase` pattern via `src/main/sqlite/sync-database.ts` — **not**
better-sqlite3). DB file under `app.getPath('userData')`.

## Boot

Start alongside the existing gateway registration at
`src/main/ipc/register-core-handlers.ts:223` (`registerCommunicationsGateway(runtime)`).
Bind `127.0.0.1:3300`. On `EADDRINUSE`, log and continue — never block app
startup on the relay.

## Signature verification

`@noble/curves` 1.9.7 is already in `node_modules` and `schnorr.verify` works
(verified). It is currently a **transitive** dep, so add it to `dobius/package.json`
explicitly rather than relying on hoisting. `nostr-tools` is only in
`vendor/buzz-desktop/package.json` — do not import it from main.

Reject on `/events` and WS `EVENT`: bad `id` (must equal the NIP-01 serialized
sha256), bad schnorr signature, or `created_at` absurdly far in the future.
This is cheap and stops a malformed local client silently poisoning the store.

## Schema (draft)

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  kind INTEGER NOT NULL,
  tags TEXT NOT NULL,      -- JSON
  content TEXT NOT NULL,
  d_tag TEXT               -- extracted for addressable-kind replacement
);
CREATE INDEX events_kind_created ON events(kind, created_at DESC);
CREATE INDEX events_pubkey_kind ON events(pubkey, kind);
CREATE TABLE event_tags (event_id TEXT, name TEXT, value TEXT);
CREATE INDEX event_tags_lookup ON event_tags(name, value);
```

`event_tags` is what makes `#p` / `#e` / `#h` / `#d` filters indexable instead
of a full scan with JSON parsing per row.

## Build order

1. `relay-event.ts` + tests — validation/verify, no I/O
2. `relay-filters.ts` + tests — pure matching, table-driven cases
3. `relay-store.ts` + tests — insert, replaceable collapse, filter→SQL
4. `relay-server.ts` + tests — HTTP routes, then WS `REQ`/`EOSE`/`CLOSE`
5. Boot wiring + `EADDRINUSE` tolerance
6. Manual check: Inbox loads, relay card goes green

## Verification

- `npm run typecheck` (node + web + cli) exits 0
- `npx vitest run --config config/vitest.config.ts <the new tests>` green
- `curl -s -XPOST localhost:3300/query -d '[{"kinds":[0],"limit":1}]'` → `[]`
  on an empty store (not a connection error)
- Buzz Inbox renders without "Failed to fetch"; sidebar card stops saying
  "Can't reach the relay"

## Risks

- **Wire-shape drift.** The contract is inferred from client call sites, not a
  spec. Build the HTTP half first and confirm the Inbox loads before writing
  the WS half — that de-risks the larger piece.
- **`limit` semantics.** NIP-01 says `limit` applies per filter, newest-first.
  Getting this wrong shows up as a feed that renders in the wrong order rather
  than an error.
- **Not a full relay.** No NIP-42 auth, no NIP-45 counts, no deletion (kind 5)
  handling unless the client turns out to need it. Local single-user only.
- Does not address the 180 unimplemented Tauri commands.

## Explicitly out of scope

- Multi-machine / Tailscale binding and the auth that requires
- Hosted always-on relay
- The renderer-crash and git-polling findings from the earlier session
