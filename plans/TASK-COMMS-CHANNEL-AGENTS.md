# TASK — Agents reply in the channel; threads stay the direct line

## What Carson asked (2026-09-02)

1. Agents in a channel reply **in the channel**, not in a thread. Threads are only
   for contacting an agent directly.
2. With 2+ agents in a channel, they can reply back and forth with each other.
3. (Same session, separate lanes:) channel create/rename is broken; thread history
   disappears on navigate-away. Tracked in their own sections below when the maps land.

## Mechanism (from the read-only map, verified anchors)

`DC` = dobius/src/renderer/src/components/communications/shared/api/dobiusCommunications.ts

- User send → `sendDobiusChannelMessage` (DC:645-687) → relay → `dispatchMessageToDobiusAgents` (DC:690).
- Dispatcher targets channel-member agents (DC:599-611, membership is enough, no mention needed),
  runs the turn in main via `agent.run` (DC:615-618 → agent-runner.ts), polls, then
  `publishDobiusAgentReply` (DC:552-566).
- Reply tags: `["h", ch]`, `["p", owner]`, `["e", parent, "", "reply"]` — the e-tag makes
  `isThreadReply` true (threading.ts:20-23) and `buildMainTimelineEntries`
  (threadPanel.ts:441-446) hides it from the channel. That is the entire "thread lock".
- The timeline already honors `["broadcast","1"]` as "reply that renders in the channel"
  (threading.ts:16-18). Readers exist; no writer does.
- Agent-to-agent: structurally off — agent publishes bypass the dispatcher. No loop guards
  exist anywhere (dispatcher has no self-check, no depth, no dedup).

## Plan

1. **Channel replies**: thread the trigger context into dispatch — `sendDobiusChannelMessage`
   knows whether the user's message was main-timeline (`parentEventId == null`) or inside a
   thread. Main-timeline trigger → agent reply keeps its `e` reply tag **plus**
   `["broadcast","1"]` → renders in the channel, still linked. Thread trigger → unchanged
   thread reply (that's the direct-contact path, per Carson).
2. **Agent-to-agent**: after publishing an agent reply, re-enter the dispatcher with
   `{ authorAgentId, depth: depth+1 }`. Guards, all in the target-selection choke point
   (DC:599-611):
   - never dispatch to the authoring agent (self-check by agent id/pubkey);
   - an agent-authored trigger only wakes agents that are mentioned in it (p-tag /
     resolved mention) — membership alone is NOT enough for agent-authored messages;
   - hard chain cap `MAX_AGENT_CHAIN_DEPTH` (8) as a backstop.
   Human-authored messages keep today's membership rule.
3. **Prompt context**: agent-authored triggers get a one-line prefix naming the author
   agent so the responder knows who is talking (today the prompt is the raw text only).
4. Verify the relay accepts the `broadcast` tag by posting one signed event live before
   relying on it (relay is out of tree).

## Test

- Unit: threading/threadPanel expectations for a broadcast-tagged agent reply; dispatcher
  target selection (self excluded, mention-required for agent authors, depth cap).
- Live: two agents in one channel, user posts once, observe A reply in channel; A mentions
  B → B replies in channel; chain terminates.

## Risks

- Relay might strip unknown tags (checked live before shipping).
- Runaway chains → the three guards above; depth cap is the backstop.
- DM channels use the same send path; DMs keep the current behavior (thread replies) in
  this task — they are the "direct" surface.

## Lane B — channel create/rename (mapped + fixed)

Neither was a missing backend. Root causes and fixes, all shipped:
- CREATE was hidden: relay-dm.ts provisions nameless kind-39000 rows for DMs;
  the create dialog treated an empty-name channel as an "exact match" for the
  empty query and suppressed the create row on open. Fixed twice: nameless
  metadata rows filtered in `loadRelayChannels`, and `hasExactMatch` now
  requires a non-empty query and a non-empty channel name.
- RENAME looked broken: relay keys addressable replacement on (pubkey, kind, d),
  so renaming a channel whose 39000 another pubkey authored left both events
  alive and the sidebar showed old + new name. Fixed: `loadRelayChannels`
  de-dupes by d-tag, newest wins across authors.
- Bonus bug: the management sheet always passes `ttlSeconds: undefined`, and the
  bare `in` check cleared an ephemeral channel's TTL on every name save. Fixed.
- NOT done (deliberate): a second rename entry point in the sidebar context menu
  — the delete path threads a callback through four layers to a confirm dialog;
  the existing Edit pencil (channel header → manage) works after the fixes.

## Lane C — thread history loss (mapped + fixed)

Messages were on the relay; the reads/writes disagreed:
- Writers tagged deep replies with the wrong thread root (`rootTag ?? parentId`,
  skipping the parent's reply target) and agent replies carried no root at all —
  the thread re-query (#e on the root) could never find them after a reload.
  Fixed via shared `resolveRelayThreadRoot` (rootTag ?? replyTag ?? parentId) in
  all three writers.
- `get_channel_window` never emitted the kind-39006 bounds event
  `parseChannelWindowResponse` requires, so every cold channel load threw.
  Fixed: real pagination (limit+1 → has_more/next_cursor) + synthetic bounds.
- `get_thread_replies` hardcoded `next_cursor: null` (threads truncated at one
  page). Fixed: forward keyset paging in memory, 1000-event ceiling commented.
- `useThreadReplies` overwrote live-subscription events with the fetch result.
  Fixed: union with the whole cache, fetched wins by id.
- Every Dobius+ tab switch unmounted the comms subtree and discarded per-mount
  QueryClients. Fixed: module-singleton clients (per-community keyed map), same
  pattern as the router.

## Phase 2 — channel agents as full working agents (2026-09-02, shipped)

Carson's asks and where each landed:
- "Too many concurrent agent runs": MAX_CONCURRENT_RUNS 3→8 (agent-runner.ts)
  AND the dispatcher queues up to 10 min (startDobiusChannelRun) instead of
  posting "could not start".
- Model / folder / tools per agent: the runner already supported all three;
  createDobiusPersona now passes them through and defaults Communications
  agents to the full toolset + `~/Dobius Agents/<name>` (runner mkdirs it).
- CLAUDE.md / memory: `settingSources: ['user','project']` on every Claude
  agent run — user skills/hooks plus the CLAUDE.md at the agent's cwd load.
- Live back-and-forth + screenshots: channel-sourced runs get two MCP tools
  (post_channel_message, post_channel_screenshot). Items land in an outbox on
  the run record; the dispatcher's poll publishes each into the channel as the
  agent, live, before the run finishes. Screenshots travel as data:image URIs
  (1.2MB cap) and the chat markdown's urlTransform now lets data:image through.
- Channel context: dispatch prompts now carry who's in the room, the last ~12
  messages with author names, and how to use the live tools / @mentions.
- Channel runs use permissionMode 'dontAsk' — headless, no approval UI to hang.

Also this phase (Carson asks, unrelated to agents):
- Clicks dying inside the hub: upstream drag regions. StartupWindowDragRegion
  installed CAPTURE listeners eating every press in the window's top 44px
  (Dobius+'s tab bar!) — now inert; embed CSS forces -webkit-app-region:
  no-drag on the whole subtree.
- Identity loading screen removed: primeDobiusIdentity() starts at chunk
  import, gate renders an empty frame instead of the logo screen.

## Phase 3 — NEXT: pluggable harnesses (opencode, Hermes, OpenClaude, …)

Carson: "use whatever agent or harness is out there, like a plug-in."
Evidence in tree: src/main/communications/providers/ has agent-provider.ts,
claude-agent-sdk-provider.ts, codex-cli-provider.ts, custom-harness-provider.ts
— a provider seam with NO production consumer yet (confirmed by the Phase-1
mapping agent). custom-harness-store.ts exists in communications/agents. The
agents-store engine enum is only 'claude' | 'codex'. Main already has modules
for opencode, hermes, openclaude, grok, gemini, cursor, droid, amp, kimi, etc.
Work: wire startAgentRun through the provider seam, extend the engine enum /
runtime catalog, surface the harnesses in the comms runtime picker.

## Test harness repair

`dobiusCommunications.test.mjs` had been broken since the identity rework
(seeded localStorage identity the module no longer reads). `installFakeRelay`
now stubs `window.api.communications` (getIdentity + real finalizeEvent
signing) and awaits `primeDobiusIdentity()`. 26/26 pass, including new
assertions for broadcast reply tags and the window bounds event.
