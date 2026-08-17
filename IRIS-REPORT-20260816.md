# Investigation Report: Dobius+ Communications — why it still doesn't work

_2026-08-16 · iris-agent · depth: deep_

## Summary

Communications is not broken by one bug. It is blocked by a **stack of four
independent failures**, and the top one is mechanical: the local relay server —
the backend every message goes through — exists only as uncommitted source
written on 2026-08-11, while the installed `/Applications/Dobius+.app` was built
on 2026-08-05. Nothing is listening on port 3300 right now, so every send and
every read fails at the network layer.

Under that sit three deeper problems that a rebuild will **not** fix: live
message delivery is still routed through a Tauri API that does not exist in
Electron; a complete second Communications UI (1,131 lines) was committed and
never wired into the app; and only 54 of 258 native commands the UI calls are
actually implemented.

---

## Key Findings

### 1. The relay backend is not in the installed app — and nothing is running it
**Severity: HIGH — this is the current, immediate outage.**

- Nothing listens on port 3300: `curl http://localhost:3300` returns code `000`,
  and `lsof -iTCP:3300 -sTCP:LISTEN` is empty.
- The Docker/Colima stack that used to host the upstream Buzz relay is down:
  `docker ps` → `Cannot connect to the Docker daemon at
  unix:///Users/bayou/.colima/default/docker.sock`.
- A replacement, first-party, in-process relay **was written** — 2,639 lines
  across `dobius/src/main/communications/relay/` (`relay-server.ts`,
  `relay-store.ts`, `relay-event.ts`, `relay-filters.ts`,
  `relay-lifecycle.ts`). It is wired into startup at
  `dobius/src/main/ipc/register-core-handlers.ts:228`.
- It has **never been built or installed**. Evidence:
  - Relay source timestamps: 2026-08-11 02:09–02:42.
  - `dobius/out/main/index.js` timestamp: 2026-08-05 08:08, and
    `grep -c startCommunicationsRelay out/main/index.js` → **0**.
  - Installed asar: `strings app.asar | grep -c startCommunicationsRelay` → **0**.
  - `~/Library/Application Support/dobius-plus/relay.db` does **not exist** —
    the relay's SQLite store has never been created, so it has never run once.
- The last commit on this branch (`4acbfe0`, 2026-08-11 02:42) is a *revert of
  the dictation orb*. The relay written in the same hour was never committed.

The relay code itself is sound: `npx vitest run src/main/communications/` →
**8 files, 206 tests, all passing**, including real HTTP and WebSocket
integration against a live server (`relay-server.test.ts:32,66,78`).
`tsc --noEmit -p tsconfig.node.json` exits 0.

**So: build + install is the single highest-value action, and it is low risk.**

### 2. Live message delivery is still routed through Tauri — permanently broken under Electron
**Severity: HIGH — survives a rebuild.**

`vendor/buzz-desktop/src/shared/api/relayClientSession.ts:537` opens the live
subscription with `invoke("plugin:websocket|connect")`. Tauri does not exist in
Electron. There is no handler for that command in
`vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts`, so
`invokeTauri` falls through to
`vendor/buzz-desktop/src/shared/api/tauri.ts:319` and throws
`Dobius Communications command is not implemented: plugin:websocket|connect`.

The consequence is worse than "no live updates". At
`vendor/buzz-desktop/src/features/messages/hooks.ts:363-388`, the code is:

```ts
relayClient.subscribeToChannelLive(channelId, ...)
  .then((dispose) => { ...; void refreshNewestWindow() })   // never runs
  .catch((error) => console.error("Failed to subscribe...", error))
```

Because the subscribe rejects, `refreshNewestWindow()` inside `.then()` never
executes. There is also **no `refetchInterval`** anywhere in that hooks file.
So an open channel has no live push *and* no polling: an agent reply that lands
correctly on the relay will not appear until you navigate away and back.

This was flagged as a known follow-up in `plans/REPAIR-communications-send.md:65-69`
and has not been addressed.

### 3. An entire second Communications UI was built and never wired in
**Severity: HIGH — 1,131 lines of dead code.**

Commit `9494526` ("new-message entry point — start a DM with an agent",
2026-08-05 03:35) added a complete native Dobius Communications surface at
`dobius/src/renderer/src/components/buzz/native/` — 10 files: `BuzzNativePage.tsx`,
`BuzzInboxSidebar.tsx`, `BuzzConversationThread.tsx`, `relay-client.ts`,
`messages.ts`, `channels.ts`, `profile.ts`, `typing.ts`, `agent-dispatch.ts`,
plus a theme stylesheet.

`BuzzNativePage` is **never imported anywhere in the repository**
(`grep -rn BuzzNativePage` matches only its own definition at
`native/BuzzNativePage.tsx:17`). `App.tsx:285,2378` renders `BuzzPage`, which
renders the vendored Buzz webview (`BuzzPage.tsx:34`).

This matters beyond wasted work: the two surfaces use **different identities**.
See finding 4.

### 4. The shipping UI keeps its private signing key in localStorage; the Keychain store is only used by the dead UI
**Severity: HIGH — security + correctness.**

- Package 1 of the plan delivered a Keychain-backed identity:
  `dobius/src/main/communications/participant-identity-store.ts` and
  `agent-participant-identity-store.ts`, exposed over IPC at
  `dobius/src/main/ipc/communications-identity.ts:16-35`.
- The **only consumer** of that IPC is the orphaned native UI
  (`native/agent-dispatch.ts:19` calls `window.api.communications.getAgentIdentity`).
- The **live** webview still reads its own private key from browser storage:
  `dobiusCommunications.ts:206-207` (`localIdentity()` → `window.localStorage`),
  and holds *agent* private keys the same way at lines `1306` and `1327`.

Two consequences:
1. **Impersonation surface.** Any code in the Communications webview can sign
   events as any agent, because it holds the agent private keys.
2. **Split identity.** The webview's pubkey and the main process's
   Keychain pubkey are different keys. Agent dispatch is matched *by pubkey*
   (`native/agent-dispatch.ts:60`), so the two halves can never agree on who an
   agent is. Confirmed live: the partition localStorage at
   `~/Library/Application Support/dobius-plus/Partitions/dobius-communications/Local Storage/leveldb`
   holds `pubkey: ebcaeee7…`, `relayUrl: ws://localhost:3300`, last written
   2026-08-16 21:30 (so the webview *is* loading — it just has no relay).

### 5. Only 21% of the command surface the UI calls is implemented
**Severity: MEDIUM-HIGH — this is the honest measure of "not working yet".**

`node config/scripts/check-communications-command-coverage.mjs` reports:

> **258 commands, 54 implemented, 180 pending, 24 awaiting removal, 0 unclassified.**

The plan (`plans/BUZZ-COMMUNICATIONS-TAKEOVER.md:48`) budgeted for 206 commands;
the real surface has grown to 258. Every pending command throws
`Dobius Communications command is not implemented: <name>` at
`tauri.ts:319` — visible in the UI as a broken control, not a graceful
degradation.

Notable pending commands a user hits immediately:
`get_presence`, `get_channel_messages_before` (history pagination),
`show_native_notification`, `upload_media` / `pick_and_upload_image` /
`download_file` (all attachments), `list_relay_members` / `add_relay_member` /
`relay_requires_membership` (all membership), `hide_dm`, `get_forum_thread`,
and the entire huddle family (`start_huddle`, `join_huddle`, `speak_agent_message`, …).

### 6. `@noble/curves` is an undeclared (phantom) dependency
**Severity: LOW-MEDIUM — a latent build break.**

`relay-event.ts:9` imports `schnorr` from `@noble/curves/secp256k1` for
signature verification. `@noble/curves` is **not** in `dobius/package.json`
dependencies or devDependencies; it resolves only because a transitive
dependency hoisted version 1.9.7 into `node_modules`. `electron.vite.config.ts`
externalizes declared deps only, so today it gets bundled and works — but the
day an upstream package drops or moves it, the relay stops verifying signatures
and the build breaks with no obvious cause.

### 7. The build trap that already cost one cycle is still live
**Severity: MEDIUM — process risk.**

`pnpm exec electron-vite build` does **not** rebuild the Buzz UI; the
`buzzRendererPlugin` in `electron.vite.config.ts:206-211` just copies a
pre-built `vendor/buzz-desktop/dist`. Editing vendored source does nothing
unless `build:buzz-ui` runs first. The correct entry point is
`pnpm run build:electron-vite`. This is documented at
`plans/REPAIR-communications-send.md:49-58` after it burned a full
build-and-verify cycle. It will burn the next one too if the fix is applied
carelessly.

### 8. What is genuinely working (so it doesn't get re-fixed)

- The REST send path is correct and **is** in the installed bundle. The
  `Message not sent` toast string from commit `699f554` is present in
  `out/renderer/buzz/assets/markdown-DUMywf6e.js` and in the installed asar's
  `out/renderer/buzz/assets/index-fLl71nYI.js`.
- The webview attaches successfully. The partition
  `persist:dobius-communications` is allowlisted in the installed build
  (`strings app.asar | grep -c persist:dobius-communications` → 4), the
  communications preload ships (`/out/preload/communications.js` is in the
  asar), and the partition directory on disk was written today at 21:29.
- The bridge is properly hardened: `communications-gateway.ts:33-41` validates
  sender URL, request shape, and command allowlist before dispatch.

---

## Architecture Map

```
Dobius renderer (App.tsx:2378)
└── BuzzPage.tsx → BuzzWorkspaceHost.tsx
    └── <webview partition="persist:dobius-communications"
                src="file://…/out/renderer/buzz/index.html?embed=dobius">
        │   preload: out/preload/communications.js  → window.dobiusCommunications
        │
        ├── control commands  → invokeTauri (tauri.ts:306)
        │                     → dobiusCommunications.ts (54 of 258 handled)
        │                     → IPC → communications-gateway.ts → RpcDispatcher
        │                     → real Dobius runtime (agents, repos, terminals)   ✅
        │
        ├── SEND / READ       → HTTP POST http://localhost:3300/events, /query   ❌ nothing listening
        │
        └── LIVE UPDATES      → invoke("plugin:websocket|connect")               ❌ Tauri, does not exist

Electron main
├── register-core-handlers.ts:228 → startCommunicationsRelay()   ← written, NOT built/installed
│   └── relay-server.ts (HTTP + ws on 127.0.0.1:3300) → relay-store.ts (node:sqlite)
├── communications-gateway.ts     (installed ✅)
└── communications-identity.ts    (Keychain) ← consumed only by the DEAD native UI

ORPHANED — compiled into the bundle, reachable by nobody:
src/renderer/src/components/buzz/native/*  (10 files, BuzzNativePage never imported)
```

---

## Risk Areas

1. **Rebuilding will look like a fix and then disappoint.** The relay coming up
   restores sending and initial channel load. It does **not** restore live
   updates (finding 2). Expect "I sent it, nothing appeared" reports right after
   the rebuild — that is finding 2, not a regression.
2. **Two identity systems will silently disagree.** If the native UI is wired in
   without migrating the webview off localStorage, human and agent pubkeys will
   differ between surfaces and DMs will route to nobody.
3. **The working tree is 42 modified + 30 untracked paths, uncommitted.**
   The Aug-5 install was built from a *dirty* tree, which is why the installed
   app contains uncommitted work (the partition fix) but not other uncommitted
   work (the relay). There is no clean mapping from any commit to what is
   installed. This will keep producing "but I fixed that" confusion.
4. **`out/` staleness.** `.dobius/NOTES.md` records that `build:unpack` fails
   packaging when `out/` is stale, and that a wrapper script can mask the
   non-zero exit. `rm -rf out dist` before building.
5. **180 pending commands fail loudly, not gracefully.** Every one surfaces a
   raw `command is not implemented` error to the user rather than a disabled
   control.

---

## Recommendations

Ordered by impact per unit of effort.

1. **Commit the relay work, then `rm -rf out dist && pnpm run build:electron-vite`
   and reinstall.** Verify before installing: `grep -c startCommunicationsRelay
   out/main/index.js` must be > 0. Verify after launching:
   `curl -s -X POST http://localhost:3300/query -d '[{"kinds":[9],"limit":1}]'`
   must return JSON, and `~/Library/Application Support/dobius-plus/relay.db`
   must exist. This alone turns Communications from dead to usable.

2. **Replace the Tauri WebSocket subscription with a browser `WebSocket`.**
   The relay already speaks NIP-01 `REQ` / `EVENT` / `EOSE` / `CLOSE` over
   plain `ws://` (`relay-server.ts:242-297`), and the webview has a native
   `WebSocket` constructor. This is a targeted change in
   `relayClientSession.ts:537,641` — the smallest fix that restores live
   delivery. A polling `refetchInterval` is the cheap fallback if the socket
   work is deferred, but it is a worse product.

3. **Decide the fate of `components/buzz/native/` — wire it in or delete it.**
   Leaving 1,131 lines of a parallel, unreachable chat UI in the tree is the
   single biggest source of "didn't we already build that?" confusion. If it is
   the intended direction, it also solves finding 4 for free, because it already
   uses the Keychain IPC.

4. **Move the webview off `window.localStorage` for private keys.** Route
   `localIdentity()` and the agent identity map
   (`dobiusCommunications.ts:206,1306,1327`) through the existing
   `communications:signEvent` / `communications:signEventAsAgent` handlers so
   private keys never enter the renderer. This is Package 1's stated deliverable
   and it is currently only half-landed.

5. **Add `@noble/curves` to `dobius/package.json`** and to
   `PACKAGED_RUNTIME_PACKAGE_ROOTS` if it ever gets externalized. One line, kills
   a latent build break.

6. **Make pending commands degrade instead of throw.** 180 of 258 will keep
   failing for a long time; a disabled control with a tooltip beats a raw
   `command is not implemented` string in the UI.

---

## Open Questions

1. **Is the in-process relay the intended replacement for the Docker/Colima Buzz
   relay, permanently?** The plan's Package 1 describes supervising the upstream
   relay plus Postgres, Redis, and S3. The Aug-11 code instead reimplements a
   NIP-01 relay over `node:sqlite` in the main process — a much simpler and
   (in my read) better answer, but it is a strategy change that was never
   written down.
2. **Which UI is the product — the vendored Buzz webview or the native one?**
   Every remaining decision (identity, dispatch, the 180 pending commands)
   depends on this answer, and both are currently half-built.
3. **Why was the relay never committed?** The session that wrote it ended on a
   revert commit at 02:42, the same minute `relay-lifecycle.ts` was last saved.
   Worth confirming nothing else from that session is also stranded.

---

## Evidence Index

Every claim above traces to one of: a command run this session (`curl`,
`lsof`, `docker ps`, `ls -la`, `strings`, `grep -c`, `npx vitest run`,
`npx tsc --noEmit`, `node config/scripts/check-communications-command-coverage.mjs`),
a file read at the cited line, or `git log` / `git show` output. Nothing here is
inferred from memory. The one explicitly *inferred* item is that the pre-Aug-11
relay was Docker-hosted: supported by the Colima socket path in the failed
`docker ps`, `docker-compose.yml` in `~/Projects (Code)/buzz`, and the plan's
"Replace current manual Colima/dev-shell lifecycle" (`BUZZ-COMMUNICATIONS-TAKEOVER.md:496`),
but not directly observed running.
