# TASK COMMS.1 — Channel/DM live view goes silent

Source: `IRIS-REPORT-20260904.md` (read-only root-cause investigation,
completed 2026-09-04). Carson's #1 priority: "Channels and DMs — that's
where everything will really happen."

## What

Three symptoms Carson saw live-testing tonight are **one bug**:
1. Agents reply in Inbox but never in Channels or DMs.
2. Full Team channel shows garbled, unattributed messages.
3. Agent names sometimes don't show at all (fixed properly in TASK COMMS.2,
   but this task's fix removes the main trigger).

## Why

`dobius/src/renderer/src/components/communications/shared/relayClientSession.ts`'s
`RelayClient.connect()` blocks `subscribe()`/`REQ` on a client-side-only
NIP-42 AUTH handshake with a 25s timeout (`AUTH_TIMEOUT_MS`, ~lines 65,
545-559). The relay server (`dobius/src/main/communications/relay/relay-server.ts`,
see `relay-auth.ts`'s own comments) never actually requires this handshake to
succeed for either HTTP or WS traffic — it's a self-imposed client gate, not
a server requirement. Inbox (`loadRelayFeed`, HTTP `/query`) and agent-reply
publishing (`publishDobiusAgentReply`, HTTP `/events`) never touch this code
path, so they keep working even when the live WS view goes dark.

If that handshake ever stalls, hangs, or races a reconnect (relay restart,
brief network blip, a slow owner-identity signing call), `ensureConnected()`
never resolves, `subscribe()` never sends `REQ`, and the channel/DM view
silently receives nothing further — no error, no indicator, nothing.

## Fix

1. In `relayClientSession.ts`: stop gating `subscribe()`/`REQ` on AUTH
   success. Send `REQ` immediately after WS `open`; let AUTH complete in
   parallel. This matches what the server actually enforces.
2. Add a visible signal when `connect()` times out or `resetConnection()`
   fires — reuse `connectionStateEmitter` if one already exists in this
   file/module; otherwise add a minimal one and surface it as a small
   connection-state indicator or toast in the Comms header. Silent failure
   is the actual bug here, not just the stall itself.
3. Read `dobius/src/main/communications/workstation/owner-signing.ts` and
   whatever `participant-identity-store.ts` it imports (owner identity —
   NOT the agent identity store already patched earlier tonight in
   `agent-participant-identity-store.ts`). Confirm whether it has the same
   unguarded `safeStorage.decryptString()` failure mode. If yes, apply the
   identical self-healing catch-and-rename fix already proven in
   `agent-participant-identity-store.ts` (catch decrypt failure → warn →
   `renameSync` to `.undecryptable-<timestamp>` → start fresh → do not
   throw). Do not invent a different shape for this fix — match the
   existing pattern exactly.

## Test

Unit test for `relayClientSession.ts`: mock a stalled/failed AUTH response
(server never sends `["OK", eventId, true, ""]`), assert `REQ` still sends
and subscription messages still arrive. If step 3 applies, mirror the
existing `agent-participant-identity-store.test.ts` "recovers with a fresh
registry when the existing file cannot be decrypted" test for the owner
store.

## Guardrails

- Do not touch server-side auth enforcement in `relay-auth.ts` — its
  behavior is correct per its own design; the bug is purely the renderer
  over-trusting its own client-side gate.
- Do not remove AUTH entirely — it should still run and still matter for
  anything that legitimately depends on it (e.g. publish-time signing
  checks elsewhere); only the subscribe-blocking behavior is wrong.
- Minimal diff. No unrelated refactor of `relayClientSession.ts`.

## Risks

- If the owner identity store (step 3) does NOT have the decrypt bug,
  don't force a fix onto it — report that sub-finding as N/A in the review
  file rather than fabricating a fix for a problem that doesn't exist.
