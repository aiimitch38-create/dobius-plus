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

## Lanes B and C (filled when maps land)

- B: channel create/rename — pending map.
- C: thread history loss — pending map.
