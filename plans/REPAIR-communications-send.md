# REPAIR — messages typed in Communications never reach the relay

_2026-08-05 · crack_repair_

## Symptom
User types `@Adam are you there?` in the `agent-lab` channel of the Communications tab.
Nothing happens: no message in the thread, no error, no toast. Agent never replies.
Relay query confirms **zero** new events — the newest event on the relay was 12:36 AM,
hours before the attempts.

## Reproduce
1. Open `/Applications/Dobius+.app` → Communications → `agent-lab`
2. Type any plain-text message, press Enter
3. `curl -s -X POST http://localhost:3300/query -H 'X-Pubkey: <64hex>' -d '[{"kinds":[9],"limit":5}]'`
   → no new event

## Root cause (found by Codex, verified line-by-line before applying)
`vendor/buzz-desktop/src/features/messages/hooks.ts:471` gated the REST send path:

    if (parentEventId || imetaTags.length > 0 || emojiTags.length > 0) { ...REST... }
    return relayClient.sendMessage(...)          // <- plain text landed here

`relayClient.sendMessage` opens a WebSocket via
`shared/api/relayClientSession.ts:537` → `invoke("plugin:websocket|connect")` from
`@tauri-apps/api/core`. **Tauri does not exist under Electron**, so every plain send
threw before reaching the relay. Replies / media / emoji already took the REST branch,
which is exactly why only those ever worked.

The throw was then swallowed whole by an **empty catch** at
`features/messages/ui/useMentionSendFlow.ts:545`, which silently restored the composer
text. Failure was indistinguishable from "nothing happened".

## Files changed (minimal, no refactor)
1. `vendor/buzz-desktop/src/features/messages/hooks.ts` — removed the conditional so
   ALL sends use the REST adapter. The existing block already handled the non-reply
   case (`baseTags`); empty imeta/emoji arrays spread to nothing. Deleted the
   `relayClient.sendMessage` fallback. `relayClient` import retained — still used for
   reconnect subscriptions at lines 351/363.
2. `vendor/buzz-desktop/src/features/messages/ui/useMentionSendFlow.ts` — the empty
   catch now `console.error`s and shows `toast.error("Message not sent: <reason>")`.
   `toast` was already imported.

## Verification
- `tsc --noEmit` on the vendored app: clean
- 759 message tests: all pass
- Artifact check before install: shipped bundle must contain `Message not sent`
- Live check: send in `agent-lab`, then re-query the relay for a new kind-9 event

## BUILD TRAP hit during this repair (cost one wasted build+verify cycle)
`pnpm exec electron-vite build` does **NOT** rebuild the Buzz UI. It copies a
pre-built `vendor/buzz-desktop/dist` (see `buzzRendererPlugin` in
`electron.vite.config.ts`). Editing vendored source does nothing unless
`build:buzz-ui` runs first. The correct entry point is:

    pnpm run build:electron-vite     # = build:buzz-ui && run-electron-vite-build.mjs

Evidence: dist was stamped 03:42 while the source edits were 06:52, and the first
build's bundle contained 0 occurrences of the new toast string.

## Rollback
    git revert <commit>        # both files, single commit
Then `pnpm run build:electron-vite && electron-builder --mac --arm64 --dir` and reinstall.
Backups of the prior installed app are in `/tmp/Dobius+-backup-*.app`.

## Known follow-up (NOT fixed here — out of scope for this repair)
`relayClient` still backs live reconnect/subscription (`hooks.ts:351,363`) on the same
Tauri WebSocket. Sending is fixed; **live receipt of incoming messages may still be
broken**, meaning an agent reply could land on the relay without appearing in the open
window until the channel is re-opened. Separate repair.
