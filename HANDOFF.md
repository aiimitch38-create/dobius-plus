# HANDOFF — Dobius+

Last updated: 2026-09-04 (Communications Hub live-bug build)

## Current state (the one thing that matters)

BUILD COMPLETE. All 4 tasks of the Communications Hub live-bug build
described in `AUTONOMOUS-BUILD.md` (context: `IRIS-REPORT-20260904.md`) are
done and committed on branch `feat/computer-use-v2`. Nothing pushed, no PR
opened, `main` untouched — all local commits, per the build's own rules.

An earlier attempt to run this build via `scripts/crackbot-supervisor.sh`
in the background got killed with no work done (confirmed: git log showed
zero new commits, the background task's captured output was just
`[killed]`/`Execution error`). The stale `claude-progress.json`/`HANDOFF.md`
this session found on resume were leftovers from a completely unrelated
older "orchestrator" build (branch `build/orchestrator`, Feb/June 2026
dates) — do not trust those old contents; they've been overwritten. This
build is now proceeding directly in-session rather than via the background
supervisor.

## Task COMMS.1 — DONE (commits `fe7d8fb9`, `67f09f2c`)

Channel/DM live view going silent, fixed. Root cause and fix: see
`plans/TASK-COMMS.1.md` and `plans/TASK-COMMS.1-REVIEW.md` for full detail.
Summary: `relayClientSession.ts`'s `connect()` no longer blocks
`subscribe()`/`REQ` on the client-side NIP-42 AUTH handshake (the relay
server never required it for subscribe/publish traffic) — AUTH now runs in
the background. Also applied the already-proven decrypt-failure self-heal to
`participant-identity-store.ts` (the owner identity store had the same
unguarded `safeStorage.decryptString()` failure mode already fixed for the
agent identity registry).

Also fixed, as build tooling (not app code): `scripts/verify-task.sh`'s
`@ts-ignore`/`@ts-nocheck`/`eslint-disable` ban was a repo-wide grep over
`dobius/src/`, which has 117 pre-existing `eslint-disable` and 2
`@ts-ignore` comments that predate this build entirely. That failed the
gate identically for every task regardless of what it touched. Rescoped to
check only lines added by the task's own commit (`git diff HEAD~1 HEAD`).

**Known gap surfaced, not fixed (flagging for a human decision):**
`relayClientSession.test.mjs` and other `@comms/**/*.test.mjs` files with
async test bodies (confirmed also true for the pre-existing
`relayWebSocketClose.test.mjs`) do not actually execute under this
project's real test command (`pnpm --dir dobius run test` →
`vitest run --config config/vitest.config.ts`) — Vitest imports them but
doesn't harvest `node:test` registrations, and for async bodies it reports
"0 test" before `node:test`'s own scheduler gets a chance to run them.
Confirmed pre-existing via `git stash` bisection (not introduced by this
task). I verified my new test manually with a throwaway Node loader
(not committed) rather than build a real fix for this — out of scope per
the "minimal diff" guardrail. Likely means dozens of existing async comms
tests are silently not running today. Full detail in
`plans/TASK-COMMS.1-REVIEW.md`.

## Task COMMS.2 — DONE (commit `551eb21d`)

Agent messages now always show a real name instead of a truncated pubkey.
See `plans/TASK-COMMS.2-REVIEW.md` for full detail. Summary: added a new
`agentNameByPubkey` fallback tier to `resolveUserLabel` (before the
truncated-pubkey fallback, after the existing DM `fallbackName` tier),
sourced from `ChannelScreen.tsx`'s already-in-hand `managedAgentsQuery.data`
rather than reusing `personaLookup` (which has a different, incompatible
meaning elsewhere — presence-of-key means "has an assigned persona").
Deliberately not wired into the Home/Inbox context pane
(`useHomeInboxContextMessages.ts`) — out of this task's Channels/DM scope;
flagged in the review file if that surface turns out to need it too.

## Task COMMS.3 — DONE (commit `b0923feb`)

Huddle button now explains why it's disabled instead of silently doing
nothing. See `plans/TASK-COMMS.3-REVIEW.md`. Summary: new
`huddleStartDisabledReason()` pure function in `huddleAvailability.ts`,
threaded through `ChannelMembersBar.tsx` → `HuddleIndicator.tsx`'s tooltip.
Traced the membership-resolution code end to end (consistent pubkey
normalization, creator always added as member on channel creation) and
found no bug in it — **could not verify live against Carson's actual
channel data** (no DevTools/CDP on this build, and installing a fresh
package is out of scope for routine per-task verification per this build's
own guardrail). **Owed**: once a human builds and installs this branch,
click the Huddle button in a channel Carson is a member of — if it's still
disabled there, the tooltip will now say why, which narrows the real bug
immediately (most likely candidate: some channels' membership never got
Carson added, e.g. seeded/legacy channels created before the
always-add-owner path existed).

## Task COMMS.4 — DONE (commit `768c7dc1`)

Channel delete/leave is now reachable from a hover "⋮" button on each
channel row, not just right-click. See `plans/TASK-COMMS.4-REVIEW.md`.
Summary: new `ChannelRowActionsMenu.tsx`, using the shadcn `SidebarMenuAction`
primitive (already in the UI kit, unused until now) — reuses the exact same
`onDeleteChannel`/`onLeaveChannel` handlers and moderation-capability gating
the existing right-click context menu already used, so no new backend
wiring and no permission-check duplication.

## What's next

All 4 tasks committed on `feat/computer-use-v2`:
`fe7d8fb9`/`67f09f2c` (COMMS.1), `551eb21d` (COMMS.2), `b0923feb` (COMMS.3),
`768c7dc1` (COMMS.4), plus 4 docs-only log commits between them.

**Two live-verification items owed** (both require building + installing a
fresh package, which this build's own guardrail says not to do for routine
per-task verification):
1. **COMMS.3**: click the Huddle button in a channel Carson is a member of.
   If still disabled there, the tooltip will now say why — most likely
   candidate per the code review: some channel's membership never actually
   included him (e.g. a channel from before `createDobiusChannel` started
   always adding the creator as `"owner"`).
2. **COMMS.4**: hover a channel row, click the new "⋮", delete a channel,
   confirm it's actually gone after a reload.

**One pre-existing test-infrastructure gap surfaced, not fixed** (flagged
in `plans/TASK-COMMS.1-REVIEW.md`): this repo's real
`pnpm --dir dobius run test` command does not actually execute `@comms/**/*.test.mjs`
files with async test bodies — Vitest imports them but doesn't harvest
`node:test` registrations, and async bodies never get a chance to run
before Vitest reports "0 test". Confirmed pre-existing (predates this
build). All new tests in this build were verified against a throwaway Node
loader instead (not committed) — real, but not wired into this repo's
actual CI/test command. Worth a human decision on whether to fix the
harness (likely: switch these files to Vitest's own `describe`/`it`, or add
a real `node --test` npm script with proper module resolution).

Next build task, if any, should start fresh from `git log --oneline -15` on
this branch rather than trusting any stale progress file — this session
itself resumed from a `claude-progress.json`/`HANDOFF.md` that turned out to
be leftovers from a completely unrelated older build.

Each follows PLAN → IMPLEMENT → VERIFY → REVIEW → COMMIT → GATE → LOG per
`AUTONOMOUS-BUILD.md`. Do not push, open a PR, or touch `main`. Do not build
or install the full app package as part of routine verification — typecheck
is the gate.

## Disk space

Was 7.8Gi free on `/System/Volumes/Data` at session start — above the 5GB
floor `AUTONOMOUS-BUILD.md` sets as the stop threshold. Re-check before each
task's VERIFY step if a build/install is ever run (it hasn't been, and
shouldn't be, for this task set).
