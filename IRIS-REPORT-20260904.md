# Investigation Report: Dobius+ Communications Hub — 5 Live Bugs (2026-09-04)

## Summary

Five bugs Carson found live-testing the Communications Hub tonight. Bugs #1–#3
(agents silent in Channels/DMs, garbled attribution, missing sender names) all
trace to **one architectural root cause**: the live channel/DM message view
depends on a WebSocket connection gated behind a client-side NIP-42 AUTH
handshake, while Inbox and agent-reply publishing both use a separate,
unauthenticated plain-HTTP path. Bugs #4 and #5 (Huddle, delete channel) are
narrower: both have fully-wired backends, but the UI either silently disables
the trigger (#4) or never exposes the action from the surface Carson tried
(#5).

## Key Findings

### Bug 1 — Agents don't reply in Channels/DMs, but do reply in Inbox
**Severity: high — confidence: medium-high (architectural, not live-reproduced)**

Two structurally different data paths exist in this codebase:

- **Inbox** (`get_feed` → `loadRelayFeed` in `dobiusCommunications.ts:2881`)
  and **agent reply publishing** (`publishDobiusAgentReply` →
  `submitRelayEvent`, `dobiusCommunications.ts:586-620,331-347`) both use
  plain `fetch()` HTTP POST to `/query` and `/events`
  (`dobiusCommunications.ts:312-323`). The relay's HTTP handler
  (`relay-server.ts:259-283`) requires no authentication at all —
  `isTrustedQueryOrigin` only checks the `Origin` header, and `/events`
  (publish) isn't gated at all.
- **The live channel/DM message view** subscribes over a real WebSocket via
  `RelayClient` (`relayClientSession.ts`). Its `connect()` method
  (`relayClientSession.ts:514-580`) blocks on receiving an unsolicited
  `["AUTH", challenge]` frame the server sends on every connection
  (`relay-server.ts:356-362`), signs it, and **will not proceed to any
  subscription (`REQ`) until the server replies `["OK", eventId, true, ""]`
  — with a 25s timeout** (`AUTH_TIMEOUT_MS`, `relayClientSession.ts:65,
  545-559`).

Server-side, `relay-auth.ts`'s own file comment confirms REQ/EVENT are
**never actually gated on auth success** — this is a purely client-side
self-imposed gate (`relayClientSession.ts` docstring: "treats this handshake
as MANDATORY"). If that WS handshake ever fails, hangs, or a reconnect
generation races (any of: relay restart mid-session, a signing hiccup on the
owner identity, a dropped socket during the 25s window), `ensureConnected()`
never resolves, `subscribe()` never sends `REQ`, and the channel/DM view
silently receives nothing further — while HTTP-based Inbox and agent-publish
keep working, because they never touch this code path at all.

This matches a bug hypothesized earlier in tonight's session ("channel
messages get wiped, shows in Inbox — hypothesized NIP-42 WebSocket auth
issue, never confirmed live") — this investigation provides the concrete
code-level mechanism for that hypothesis but does not confirm it against a
live failure (see Open Questions).

**Minimal fix directions** (not implemented): (a) instrument
`relayClientSession.ts`'s `connect()`/`resetConnection()` to log/toast on
auth timeout so failures are visible instead of silent; (b) consider not
blocking subscription on AUTH success at all, since the server doesn't
require it — subscribe immediately and let AUTH complete in parallel; (c)
verify the owner identity's signing (`participant-identity-store.ts`, sibling
to the agent identity store I patched earlier tonight) doesn't have the same
unguarded `safeStorage.decryptString()` failure mode I fixed in
`agent-participant-identity-store.ts` — if the owner's own AUTH-event signing
throws, this exact symptom results.

### Bug 2 — Full Team channel renders messages without proper attribution
**Severity: medium — confidence: medium (same root cause as #1 and #3)**

Confirmed `KIND_STREAM_MESSAGE = 9` (`shared/constants/kinds.ts:4`) matches
what `publishDobiusAgentReply` sends, so this isn't a kind mismatch. The
garbled rendering (raw "friday", "hello", "hello" with no clear sender
header) is consistent with a channel view that received a **partial,
inconsistently-ordered event set** — some via the initial HTTP-backed history
fetch, more via a WS subscription that stalled partway (bug #1) — combined
with missing profile data (bug #3) collapsing multiple different senders'
messages into what looks like one ungrouped block. No separate rendering bug
was found in `formatTimelineMessages.ts`'s grouping logic itself; the
grouping code assumes complete, correctly-attributed input.

### Bug 3 — Agent name doesn't always show on their messages
**Severity: high (explicitly Carson's top priority) — confidence: medium-high**

`formatMessageAuthor` → `resolveUserLabel`
(`features/profile/lib/identity.ts:91-131`) falls back, when no profile is
resolvable, to `truncatePubkey(pubkey)` — a raw hex fragment, not the agent's
name (there's no "unknown agent" placeholder). Profile data has to come from
somewhere: `ensureDobiusAgentProfile` (`dobiusCommunications.ts:568-584`)
publishes a kind-0 profile event for an agent **lazily, the first time it
replies**, and only once per session (`publishedAgentProfiles` Set). Two
independent ways this drops the name:

1. If the channel view's profile data is populated via the same WS
   subscription implicated in bug #1, a stalled subscription means the
   freshly-published kind-0 event for a first-time-replying agent never
   arrives client-side, and every message from that agent renders as a
   truncated pubkey until the next full reload re-fetches history over HTTP.
2. `agentPubkeysById()` (`dobiusCommunications.ts:1847-1858`) was recently
   changed from `Promise.all` to `Promise.allSettled` specifically so one
   agent's identity-IPC failure doesn't block the whole batch — but a
   rejected entry now resolves to **no name shown at all** rather than any
   visible fallback (not even the agent's known display name from
   `agent.list`, which the caller already has in hand as `agent.name`).

**Fix direction**: `formatMessageAuthor`/`resolveUserLabel`'s fallback chain
has no agent-name fallback distinct from the DM-only `fallbackName` path —
worth adding one so a message from a known Dobius agent (matched by pubkey
against the already-fetched agent list, independent of whether its kind-0
profile event has propagated) always shows its real name, never a truncated
hex string.

### Bug 4 — "Start Huddle" does nothing
**Severity: medium — confidence: high**

The backend is fully wired end-to-end: `HuddleIndicator`'s `onStart`
(`ChannelMembersBar.tsx:114-137`) → `startHuddle()` (`HuddleContext.tsx:421`)
→ `invoke("start_huddle")` → `dobiusCommunications.ts:3764`
(`case "start_huddle"`) → `invokeDobiusRuntime("huddle.start", ...)` → a
registered main-process RPC method (`huddle-lifecycle-methods.ts:36-46`)
backed by a real `HuddleSessionStore`. This is not a stub.

The button Carson clicked is this exact component — it's rendered in the
channel header via `ChannelScreenHeader` → `ChannelMembersBar` (confirmed:
`ChannelScreenHeader.tsx:87-95`), matching the headphone icon next to the
"👥 3" member count in his screenshot.

**Root cause, high confidence**: the button is disabled, not broken.
`ChannelMembersBar.tsx:136` sets `startDisabled={!canStartHuddle ||
isStartingHuddle}`. `canStartHuddleInChannel` (`huddleAvailability.ts:10-35`)
requires, for a non-DM channel, `channel.visibility === "open" || selfMember
!== null` — and `selfMember` depends on `useChannelMembersQuery` resolving
the current user's own pubkey inside the channel's member list. If that
query is still loading, errors, or fails to match (e.g. a pubkey-casing or
membership-tag mismatch — the kind of bug already seen elsewhere in this
codebase tonight with agent pubkey resolution), the button silently disables
with **zero visible explanation** — an outlined icon button gives no "why"
tooltip when disabled. A user clicking a visually-normal-looking but disabled
button perceives exactly "I click it and nothing happens."

Secondary possibility (not confirmed): if `canStartHuddle` is actually true
and the click does fire, `startHuddle` needs microphone access
(`getUserMedia`) — the same class of ad-hoc-signing-breaks-TCC-grants issue
already diagnosed for Accessibility permission earlier tonight
(`NOTES.md`, `dobius-plus/config.json` Voice section) could equally revoke
Microphone access on a rebuild, producing a caught-and-toasted
(`ChannelMembersBar.tsx:130-133`) but easy-to-miss error.

### Bug 5 — No way to delete a channel from the sidebar
**Severity: low — confidence: high**

Backend fully exists: `case "delete_channel"` (`dobiusCommunications.ts:2994`)
→ `deleteDobiusChannel(args)`, a real implementation. A "Delete channel" UI
action also already exists — inside `ChannelManagementSheet.tsx` /
`ChannelManagementModerationActions.tsx`, reached by opening a channel →
"⋮" → **Manage channel**.

The menu Carson right-clicked (screenshot: "Channels ▾ [+] [⋮]" showing only
"Sort") is a **different, section-level menu** —
`SectionActionsMenu` in `CustomChannelSection.tsx:120-269` — explicitly
documented as "the single 'more actions' menu shown at the right edge of
every sidebar **section header**" (mark-all-read, browse, create, rename/
move/delete **section**, sort). It has no per-channel-row context menu at
all; deleting an individual channel currently requires opening it first.
This is a real, narrow UX gap (missing entry point), not a missing
capability.

## Architecture Map

```
Human types in a channel
  → sendDobiusChannelMessage()          [dobiusCommunications.ts, HTTP POST /events]
      → dispatchMessageToDobiusAgents()  [same file, in-process]
          → startDobiusChannelRun()      [agent.run RPC → real agent execution]
          → publishDobiusAgentReply()    [signEventAsAgent → HTTP POST /events]

Reading a channel/DM (LIVE view)
  → RelayClient.connect()                [relayClientSession.ts]
      → blocks on WS AUTH round-trip (25s timeout, client-side only gate)
      → subscribeToChannel/Live()         [WS REQ — never reached if AUTH stalls]

Reading Inbox
  → get_feed → loadRelayFeed()            [dobiusCommunications.ts, HTTP POST /query]
      → buildInboxItems()                 [home/lib/inbox.ts, pure client-side grouping]
```

The relay server (`relay-server.ts`) treats HTTP and WS as two doors into the
same store, and — per its own comments — never actually requires the WS
AUTH handshake to succeed for either reads or writes. Only the renderer's own
`RelayClient` imposes that requirement on itself.

## Risk Areas

- Any transient WS hiccup (relay restart, brief network blip, a slow signing
  call) during the 25s AUTH window silently degrades the entire live
  Channel/DM experience app-wide, with no user-visible error — this is a
  single point of failure for the feature Carson called "where everything
  will really happen."
- The lazy, once-per-session kind-0 profile publish
  (`ensureDobiusAgentProfile`) means an agent's very first message in a
  fresh session is the one most likely to render with no name — exactly the
  first impression a new user gets.
- Disabled-with-no-explanation buttons (Huddle) are a recurring UX risk
  pattern worth checking elsewhere in this UI — a `Tooltip` already wraps the
  Huddle button but its content doesn't change to explain *why* it's
  disabled.

## Recommendations (ordered by impact)

1. **Bug 1/2/3 (one fix, highest impact)**: make the channel/DM live view
   resilient to the WS AUTH handshake stalling — either stop blocking
   subscriptions on AUTH success (server doesn't require it) or surface a
   visible connection-state indicator/toast when `connect()` times out or
   `resetConnection()` fires, instead of failing silently. Also audit
   `participant-identity-store.ts` (owner identity) for the same unguarded
   `safeStorage.decryptString()` pattern already fixed in
   `agent-participant-identity-store.ts` tonight.
2. **Bug 3 fix**: give `formatMessageAuthor`/`resolveUserLabel` an
   agent-name fallback sourced from the already-in-hand agent list (matched
   by pubkey), independent of kind-0 profile propagation timing.
3. **Bug 4 fix**: when `canStartHuddleInChannel` returns false, change the
   tooltip text to explain why (e.g. "Members list is still loading" /
   "You're not a member of this channel") instead of a generic "Huddle"
   label on a silently-disabled button.
4. **Bug 5 fix**: add a per-channel-row context menu (or extend the existing
   row's hover actions) in the sidebar with "Delete channel" /
   "Leave channel", calling the already-working `delete_channel` /
   `leave_channel` commands directly, rather than requiring a detour through
   "Manage channel."

## Open Questions

- **Bug 1 is not confirmed by live reproduction.** I did not have a running
  instance with devtools open to check `RelayClient.getConnectionState()` or
  look for a "Relay authentication timed out" console log at the moment
  Carson saw the failure. The architectural mechanism is solid and
  well-evidenced, but confirming it needs one live check: open the
  Communications devtools console while sending a channel message and watch
  for auth-timeout/reconnect logging, or add a temporary
  `connectionStateEmitter` subscriber to the UI.
- Whether `participant-identity-store.ts` (owner identity, distinct from the
  agent identity store already patched tonight) has the same
  unguarded-decrypt failure mode was not directly confirmed — I did not read
  that file this session; it's named only by inference from
  `owner-signing.ts`'s import.
- Whether bug 4 is actually the disabled-button case versus a real
  `huddle.start` runtime failure (e.g., a mic-permission TCC issue) was not
  distinguished — both are plausible and would need a live click with
  devtools/toast observation to tell apart.
