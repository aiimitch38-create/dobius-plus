# TASK COMMS.2 — Review

## What changed

Added a new fallback tier to `resolveUserLabel` in
`dobius/src/renderer/src/components/communications/features/profile/lib/identity.ts`,
inserted between the existing `fallbackName` (DM-only) tier and the final
`truncatePubkey` fallback: match the message's pubkey against a new
optional `agentNameByPubkey?: Map<string, string>` and use that name if
found. Nothing about the existing resolution order for `displayName` →
`nip05Handle` → `fallbackName` changed.

Threaded the new map through, as a trailing optional parameter at every
layer so none of `resolveUserLabel`'s ~35 other call sites needed touching:

- `formatMessageAuthor` (`formatTimelineMessages.ts`) — new param, passed to `resolveUserLabel`.
- `formatTimelineMessages` (same file) — new trailing optional param, passed to `formatMessageAuthor` inside `getAuthorLabel`.
- `useIndependentThreadPanel.ts` — new `agentNameByPubkey` field on its args object, passed through to `buildIndependentThreadPanel` (which needed no change — it already forwards its tail args generically via `Tail<Parameters<typeof formatTimelineMessages>>`).
- `ChannelScreen.tsx` — the one place that actually **builds** the map: extended the existing `personaLookup`/`respondToLookup` `useMemo` (already iterating `managedAgentsQuery.data`) to also populate `agentNameByPubkey` (`agent.pubkey.toLowerCase() → agent.name`, unconditional — unlike `personaLookup`, which only gets an entry when a persona is explicitly assigned). Passed to both `formatTimelineMessages` and `useIndependentThreadPanel` call sites in this file.

`useHomeInboxContextMessages.ts` (the third caller of `formatTimelineMessages`,
for the Home/Inbox detail pane) was deliberately **not** wired — it doesn't
currently receive `personaLookup`/`respondToLookup` either (passes
`undefined` for both today), and the plan's scope is Channels/DMs
specifically. The new param defaults to `undefined` there, so behavior is
unchanged, not regressed.

## Why

Read in full: `plans/TASK-COMMS.2.md`, `IRIS-REPORT-20260904.md`.

Traced both triggers to their real source:
- Trigger 1 (lazy kind-0 publish race) — confirmed `ensureDobiusAgentProfile` only publishes on an agent's first reply, so `profiles` genuinely has no entry yet for that pubkey on the first render.
- Trigger 2 (`agentPubkeysById()`'s `Promise.allSettled`) — found the actual caller, `loadDobiusManagedAgents()` in `dobiusCommunications.ts:2061-2124`: a rejected pubkey lookup for one agent drops that agent entirely from the returned list (`.filter((agent) => pubkeyById.has(agent.id))`), which is where "no name shown at all" comes from. Per the plan's own Fix section, the mitigation is using the renderer's **separately-fetched, already-in-hand** agent list (`managedAgentsQuery.data`, built at a different point in that query's lifecycle) as the fallback source — not editing `loadDobiusManagedAgents()`'s allSettled filtering itself, which the plan doesn't ask for and which is a distinct, unrelated agent-list-completeness concern.

Deliberately did **not** reuse the existing `personaLookup` map for this,
even though it's the same shape (`Map<string, string>` keyed by lowercased
pubkey) and already threaded through the exact same call chain. Checked its
other consumer first: `SystemMessageRow.tsx` uses
`personaLookup?.has(normalizedPubkey) === true` as an **"is this a
persona message" boolean**, and `formatTimelineMessages.ts` uses it to set
`personaDisplayName` only for `role === "bot"`. Widening `personaLookup` to
include every managed agent (not just ones with an assigned persona) would
have silently changed both of those semantics for every agent-without-persona
message. Added a separate `agentNameByPubkey` map instead — same cost (one
more field on an already-existing `useMemo`), zero risk to existing behavior.

## What I tested

- `identity.test.mjs`: 4 new `resolveUserLabel` unit tests — known agent with
  no cached profile resolves to its name; case-insensitive pubkey matching;
  falls back to truncated pubkey when the agent isn't in the known list
  either (the "nothing anywhere resolves it" case — not a regression, matches
  pre-existing behavior for any unresolvable pubkey); a real resolved
  `profiles` entry still wins over the agent-name fallback (order preserved).
- `formatTimelineMessages.test.mjs`: 1 new integration-level test — a full
  `formatTimelineMessages()` call with an agent pubkey, no profile, and
  `agentNameByPubkey` set, asserting `message.author === "Scout"`.
- All 5 new tests + the 32 pre-existing tests across both files pass (37/37),
  verified with the same throwaway Node loader used for Task COMMS.1 (see
  that review file — this repo's real `pnpm --dir dobius run test` doesn't
  actually execute either of these `.mjs` files' `node:test` suites; both
  happen to have synchronous bodies so, per the pattern documented in
  COMMS.1's review, they at least print real `ok`/`not ok` TAP output under
  Vitest even though Vitest marks the file "failed" — I did not rely on that
  for confidence here, the loader-based run is authoritative).
- `pnpm --dir dobius run typecheck` — exit 0.
- `npx oxlint` on all 6 touched files — one new violation surfaced from my
  own test addition (`formatTimelineMessages.test.mjs` crossed the 600-line
  cap for test files), fixed by compacting the new test's call onto fewer
  lines rather than suppressing the rule. Confirmed via `git stash`
  bisection that every remaining oxlint finding on these files is
  pre-existing and unchanged by this diff.

## Risk for a human reviewer to double-check

- `agent.name` — confirmed by reading `loadDobiusManagedAgents()`'s mapping
  (`name: agent.name` at `dobiusCommunications.ts:2079`) that this field
  exists on the renderer-facing `DobiusManagedAgentProjection` shape that
  `managedAgentsQuery.data` resolves to; typecheck passing on `ChannelScreen.tsx`
  is the actual proof (`agent.name` would be a type error otherwise), not
  just my reading.
- The Home/Inbox context pane (`useHomeInboxContextMessages.ts`) still
  doesn't get this fallback — flagged above as an intentional scope
  boundary, not an oversight. If Carson also sees truncated-pubkey agent
  names in that surface, it needs the same wiring `ChannelScreen.tsx` got.
