# Communications: move to a Discord-shaped model

Date: 2026-09-03
Status: root cause found + fixed for DM persistence tonight; channel-model rework below is proposed, not yet built.

## The live bug Carson reported (fixed tonight)

Symptom: "None of our direct messages stays either on restart or when I go out
of communication and come back into communications."

Root cause: `relay-dm.ts` provisions every DM's metadata event (kind 39000)
with only `d` + `p` tags — no `name`, by design (a DM's display name is
derived client-side from the other participant, never stored on the event).
Earlier tonight, `loadRelayChannels()` in `dobiusCommunications.ts` was
changed to drop any metadata row with an empty `name` tag, to stop duplicate
nameless provisioning rows from polluting the channel list and the create
dialog. That fix didn't know about DMs' by-design namelessness, so it dropped
every DM too — meaning a DM only ever survived via the create call's local
optimistic response, and vanished the instant the client re-fetched the
channel list (which happens on tab switch and on restart).

Fixed: the filter now exempts `channel_type === "dm"` rows. See
`dobiusCommunications.ts` around `loadRelayChannels()`.

## Still open: "conversation gets wiped, goes to my inbox"

Carson's second symptom — regular channel conversations (e.g. "team")
not staying visible, with the content instead surfacing via Inbox — does
NOT yet have a confirmed root cause. `getDobiusChannelWindow()` (the
channel-message-history fetch) and `loadRelayFeed()` (the Inbox/mentions
fetch) are two separate, correctly-separated queries — Inbox pulls
messages that `#p`-tag Carson specifically, independent of whether the
channel itself is loading correctly. This needs live reproduction (open a
channel, send messages as an agent, restart, observe) before a fix is
attempted — flagged as the first task in the build plan below, not guessed
at here.

## What "the Discord model" actually is (for reference)

Discord's shape, plain and stable across the product for years:

- **Server → channel → message**, one canonical timeline per channel,
  stored server-side. A client never "owns" the history — it just fetches a
  window of it. Reopening a channel always shows the same messages everyone
  else sees, because there's one copy, not a per-client cache that can rot.
- **DMs are just channels** between exactly the participants, with no public
  listing — same message model, same persistence, same pagination as any
  other channel. There is no separate "DM storage" that behaves differently.
- **Threads are child channels**, not a different mechanism. A thread has
  its own timeline, but posts also summarize back into the parent channel
  (a small "N replies" preview), so you don't have to enter the thread to
  know something happened. Replies to a *specific* message thread there;
  everything else is a normal channel post.
- **Inbox / "Unreads" is a view, not a store.** It's a computed list of
  "channels with activity since your last read marker," pointing back at
  the same channel timelines — never a separate copy of the messages.

Dobius's current architecture already matches this shape structurally
(channels are Nostr events on a relay, the relay is the one persistent
store, DMs are channel rows with `channel_type: "dm"`, not a separate
system) — tonight's bug was a client-side filter accidentally treating DMs
as junk, not an architectural gap. The "Inbox pollutes channel history"
symptom needs to be confirmed as a real second instance of the same class
of bug (a fetch/filter silently dropping real data) before deciding whether
any deeper redesign is actually needed, versus another local fix like this
one.

## Recommendation

Don't restart the architecture — investigate the second symptom with the
same rigor as the first (reproduce live, find the exact query/filter at
fault, fix that one thing) before assuming a bigger rebuild is needed. See
Phase 0 in `plans/TASK-PUNCH-LIST-BUILD.md`.
