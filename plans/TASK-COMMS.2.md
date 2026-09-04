# TASK COMMS.2 — Agent name must always show on their messages

Source: `IRIS-REPORT-20260904.md`. Carson explicitly called this the single
most important item: agent identity must always be visible.

Depends on TASK COMMS.1 being done first (same area, don't duplicate
investigation — the connection-silence fix removes the main trigger for this
bug, but a second independent trigger remains and needs its own fix below).

## What

A message from a known Dobius-managed agent sometimes renders with a
truncated pubkey hex string instead of the agent's real name.

## Why

`formatMessageAuthor` → `resolveUserLabel`
(`dobius/src/renderer/src/features/profile/lib/identity.ts:91-131`) falls
back to `truncatePubkey(pubkey)` when no profile is resolvable — there is no
"known agent, no profile yet" fallback tier.

Two independent triggers:
1. An agent's kind-0 profile publishes lazily, only on its first reply per
   session (`ensureDobiusAgentProfile`,
   `dobius/src/renderer/src/components/communications/shared/api/dobiusCommunications.ts:568-584`).
   A first-time reply can render before that profile event has propagated.
2. `agentPubkeysById()`
   (`dobiusCommunications.ts:1847-1858`) uses `Promise.allSettled` so one
   agent's identity-IPC failure doesn't block the whole batch — but a
   rejected entry currently resolves to no name shown at all, not even the
   agent's already-known display name.

## Fix

In `formatMessageAuthor`/`resolveUserLabel`, add a fallback tier **before**
the truncated-pubkey fallback: match the message's pubkey against the
already-in-hand Dobius agent list (`agent.list` — the same data
`agentPubkeysById()`'s caller already has as `agent.name`) and use that name
if found. A message from a known Dobius agent must never show a raw hex
string, regardless of whether its kind-0 profile has propagated yet.

## Test

Unit test: render a message from an agent pubkey with no kind-0 profile
cached (simulate the lazy-publish race); assert the agent's real name shows,
not a truncated pubkey. Second test: simulate `agentPubkeysById()` rejecting
one entry; assert that agent's messages still show its known name.

## Guardrails

- Don't touch the DM-only `fallbackName` path — this is a distinct,
  additive fallback tier for known agents specifically, not a rewrite of the
  whole resolution chain.
- Minimal diff.
