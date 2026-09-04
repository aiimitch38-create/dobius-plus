# TASK-COMMS-LIVE-BUGS-20260904 — Fix 5 live Communications Hub bugs

Source: `IRIS-REPORT-20260904.md` (evidence-backed root-cause investigation,
read-only, completed 2026-09-04). Carson found these live-testing the app
tonight. Ranked in his stated priority order.

Branch: `feat/computer-use-v2` (current). Small, mostly-disjoint-file scope —
building directly in this worktree rather than fanning out to parallel
worker worktrees.

---

## TASK 1 — Channel/DM live view goes silent (Bugs #1, #2, #3 — ONE root cause)

**Priority: highest.** Carson: "that's where everything will really happen."

**Root cause:** `relayClientSession.ts`'s `RelayClient.connect()` blocks
`subscribe()`/`REQ` on a client-side-only NIP-42 AUTH handshake with a 25s
timeout (`AUTH_TIMEOUT_MS`, lines 65, 545-559). The relay server never
actually requires this for reads or writes (`relay-auth.ts` comment, HTTP
`/query` and `/events` are unauthenticated). Inbox and agent-reply publishing
use plain HTTP and are unaffected — only the live WS-subscribed Channel/DM
view can go silently dark if that handshake stalls, hangs, or races a
reconnect. Same stalled-profile-data path also explains agent names
sometimes missing (Bug #3) and garbled Full Team attribution (Bug #2) — both
downstream of the same stalled subscription.

**Fix:**
1. In `relayClientSession.ts`, stop gating `subscribe()`/`REQ` on AUTH success.
   Send `REQ` immediately after WS `open`; let AUTH complete in parallel
   (matches what the server actually enforces — see `relay-auth.ts`).
2. Add a visible signal when `connect()` times out or `resetConnection()`
   fires — a toast or a small connection-state indicator in the Comms header
   — instead of failing silently. Reuse whatever `connectionStateEmitter`
   already exists (referenced in IRIS report Open Questions) if present;
   otherwise a minimal one.
3. Read `participant-identity-store.ts` (owner identity — NOT the agent
   identity store already patched tonight) and confirm whether it has the
   same unguarded `safeStorage.decryptString()` failure mode fixed in
   `agent-participant-identity-store.ts` earlier tonight. If yes, apply the
   identical self-healing catch-and-rename fix (same shape, don't
   re-invent).

**Verify:** unit tests for `relayClientSession.ts`'s connect/subscribe
ordering (mock a stalled/failed AUTH response, assert REQ still sends and
messages still arrive). Live smoke test: send a channel message, confirm
agent reply appears in the channel thread (not just Inbox) within a few
seconds.

**Guardrail:** do not touch server-side auth enforcement — `relay-auth.ts`'s
behavior is correct per its own design; the bug is purely the renderer
over-trusting its own gate.

---

## TASK 2 — Agent name must always show (Bug #3, remaining piece)

Depends conceptually on Task 1 but is a distinct, smaller fix: even with
Task 1 fixed, a first-time-replying agent's kind-0 profile is published
lazily (`ensureDobiusAgentProfile`, `dobiusCommunications.ts:568-584`) and
could still race message rendering.

**Fix:** `formatMessageAuthor`/`resolveUserLabel`
(`features/profile/lib/identity.ts:91-131`) currently falls back to
`truncatePubkey(pubkey)` when no profile resolves. Add a fallback tier
*before* the truncated-pubkey fallback: match the message's pubkey against
the already-in-hand Dobius agent list (`agent.list`, same data
`agentPubkeysById()` already has) and use `agent.name` if found. Never show a
raw hex string for a known Dobius-managed agent.

**Verify:** unit test — render a message from an agent pubkey with no kind-0
profile cached; assert the agent's real name shows, not a truncated pubkey.

---

## TASK 3 — Huddle button silently does nothing (Bug #4)

**Root cause, high confidence:** not broken — disabled. `canStartHuddleInChannel`
(`huddleAvailability.ts:10-35`) requires channel membership to resolve first;
if `useChannelMembersQuery` is loading, errors, or the current user's pubkey
doesn't match a membership tag, the button silently disables with no
explanation (`ChannelMembersBar.tsx:136`).

**Fix:**
1. Change the Huddle button's tooltip to explain *why* it's disabled
   (e.g. "Members list is still loading" / "You're not a member of this
   channel") instead of a static "Huddle" label — a `Tooltip` wrapper
   already exists (`ChannelMembersBar.tsx:130-133`), just needs
   conditional content.
2. Confirm (don't just assume) whether the underlying membership-resolution
   query is itself failing for Carson's channels — if `selfMember` never
   resolves even after load completes, that's the real bug to fix, not just
   the tooltip. Check for a pubkey-casing/membership-tag mismatch (same bug
   class already seen with agent pubkey resolution tonight).
3. If mic permission (`getUserMedia`) is a live blocker once the button IS
   enabled, confirm the existing catch-and-toast (`ChannelMembersBar.tsx:130-133`)
   actually surfaces a visible, readable error — not a console-only one.

**Verify:** live smoke test — open a channel Carson is definitely a member
of, confirm the button is enabled and huddle starts. If still disabled,
tooltip must say why.

---

## TASK 4 — Delete channel needs a direct entry point (Bug #5)

**Root cause, high confidence:** not missing — misplaced. `delete_channel`
backend command and a "Delete channel" UI action already exist inside
`ChannelManagementSheet.tsx` / `ChannelManagementModerationActions.tsx`
(open channel → "⋮" → "Manage channel"). The menu Carson tried (sidebar
"Channels" section header dropdown, `SectionActionsMenu` in
`CustomChannelSection.tsx:120-269`) is a different, section-level menu with
no per-channel-row entry at all.

**Fix:** add a per-channel-row context menu (or hover action) in the
sidebar channel list, offering "Delete channel" / "Leave channel", calling
the already-working `delete_channel` / `leave_channel` commands directly.
Do not touch `SectionActionsMenu` — it's working as designed for
section-level actions (sort etc.), this is a missing sibling, not a bug in
it.

**Verify:** live smoke test — right-click (or hover-menu) an individual
channel row in the sidebar, delete it, confirm it's gone and the backend
command actually ran (not just an optimistic UI removal).

---

## Order of work

1. Task 1 (highest impact, unblocks the feature Carson called most important)
2. Task 2 (small, same area, do right after Task 1 while context is warm)
3. Task 3 (independent, smaller)
4. Task 4 (independent, smallest, lowest severity)

## Done Bar (applies to the whole set before calling this done)

Typecheck + build exit 0 → code-review skill pass on the diff → live smoke
test each of the 4 tasks in the running app (not just unit tests) → append
BUILD-LOG.md entry → confirm with Carson before merge, per house rules (he
clicks merge, not me).
