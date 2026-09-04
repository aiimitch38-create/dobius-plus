# TASK COMMS.3 — Huddle button silently does nothing

Source: `IRIS-REPORT-20260904.md`. Independent of TASK COMMS.1/.2 — different
files, safe to do in either order.

## What

Clicking "Start Huddle" in a channel header does nothing visible.

## Why

The backend is fully wired end-to-end (verified, not a stub):
`HuddleIndicator`'s `onStart`
(`dobius/src/renderer/src/components/communications/.../ChannelMembersBar.tsx:114-137`)
→ `startHuddle()` (`HuddleContext.tsx:421`) → `invoke("start_huddle")` →
`dobiusCommunications.ts:3764` (`case "start_huddle"`) →
`invokeDobiusRuntime("huddle.start", ...)` → a registered main-process RPC
method (`huddle-lifecycle-methods.ts:36-46`) backed by a real
`HuddleSessionStore`.

Root cause: the button is **disabled**, not broken.
`ChannelMembersBar.tsx:136` sets `startDisabled={!canStartHuddle ||
isStartingHuddle}`. `canStartHuddleInChannel`
(`.../huddleAvailability.ts:10-35`) requires, for a non-DM channel,
`channel.visibility === "open" || selfMember !== null` — and `selfMember`
depends on `useChannelMembersQuery` resolving the current user's own pubkey
inside the channel's member list. If that query is loading, errors, or fails
to match (a pubkey-casing or membership-tag mismatch — the same bug class
already seen with agent pubkey resolution elsewhere in this codebase), the
button disables with zero visible explanation.

## Fix

1. Give the Huddle button's existing `Tooltip` wrapper
   (`ChannelMembersBar.tsx:130-133`) conditional content that explains *why*
   it's disabled — e.g. "Members list is still loading" while
   `useChannelMembersQuery` is pending, "You're not a member of this
   channel" if it resolved and `selfMember` is still null. Never a static
   "Huddle" label on a silently-disabled button.
2. Investigate whether `useChannelMembersQuery` itself is failing to resolve
   `selfMember` for Carson's channels even after load completes — check for
   a pubkey-casing or membership-tag mismatch. If found, fix the actual
   membership resolution, not just the tooltip — the tooltip fix alone is a
   partial fix if the real bug is a broken membership query.
3. Confirm the existing mic-permission catch-and-toast
   (`ChannelMembersBar.tsx:130-133`) surfaces a visible, readable error if
   `getUserMedia` fails once the button IS enabled — not a console-only
   failure.

## Test

Live smoke test: open a channel Carson is definitely a member of, confirm
the button is enabled and a huddle actually starts. If it's still disabled
in a channel he should be a member of, that's the membership-query bug from
step 2 — fix that, don't just improve the tooltip and call it done.

## Guardrails

- Don't touch `HuddleSessionStore` or the RPC layer — confirmed already
  working.
- Minimal diff.
