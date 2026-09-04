# Punch-list build plan

Date: 2026-09-03. Source: `plans/TASK-PUNCH-LIST-BUILD.md` companion artifact
("The Punch List"), itself built from 4 parallel research passes + live
verification against `feat/computer-use-v2` after tonight's merge.

Ground rules for dispatch (why phases are shaped the way they are):

- **The Communications translator (`dobiusCommunications.ts`) is one giant
  file (~3800 lines).** Every "add a missing command" task edits it. Workers
  editing the same file in parallel risk conflicts (we saw this exact class
  of bug tonight — two branches independently duplicated a block of type
  declarations, and it only surfaced as a typecheck error, not a merge
  conflict). Translator-file work is grouped into a small number of workers,
  each owning a clean, non-overlapping *region* of commands, not one worker
  per command.
- **Anything flagged "needs Carson's decision" is NOT dispatched.** Several
  punch-list items have explicit open design questions (ADAM plugin
  security model, keep-vs-delete on `ClaudeAgentSdkProvider`, the orphaned
  floating-orb window) or need credentials only Carson has (Apple Developer
  signing). Those are listed under "Needs your call" and nothing gets
  spawned for them until you answer.
- **Nothing gets dispatched for the auto-mode/headless-conductor work.**
  It was paused deliberately ("these spawn a headless claude and/or
  auto-send messages, which shouldn't run unattended") — that reasoning
  still applies.
- **Orchestration is blocked until the CLI is fixed.** Tonight's build had a
  real bug: `out/cli/index.js` gets built successfully but something in the
  multi-target Vite build clears it before packaging, so the installed
  `dobius` CLI throws `MODULE_NOT_FOUND` on every command. Fixed by
  reordering `build:cli` to run last in `package.json`'s build scripts.
  Phase 0 below is "rebuild, reinstall, confirm `dobius status --json`
  works" — nothing else can be dispatched via `dobius orchestration` until
  that's green.

## Phase 0 — Unblock orchestration + the two live bugs (sequential, do first)

1. Rebuild + reinstall with the CLI-ordering fix. Confirm `dobius status
   --json` succeeds.
2. DM persistence — **fixed tonight** (`loadRelayChannels` DM exemption).
   Verify live once the rebuilt app is running: create a DM, switch off
   Communications and back, confirm it's still there.
3. "Channel conversation gets wiped, shows in Inbox instead" — **not yet
   root-caused**. Reproduce live (send messages in a named channel as an
   agent, leave and return, restart) and find the actual fetch/filter at
   fault, same method as the DM bug. Do this before anything else in
   Communications, since several other tasks below assume channel history
   works.

## Phase 1 — Security pass (parallel-safe, no shared files)

Two workers, split by area — files don't overlap:

- **Worker A (main process):** relay `/query` CORS+auth gap, `media.upload`
  arbitrary-path-read (wire the existing unused path guard), the
  `shell:openInExternalEditor` command-escaping gap, an `unhandledRejection`
  guard in main (agent-runner.ts:334's crash path).
- **Worker B (renderer):** agent private keys out of `localStorage` (sign in
  main process instead, delete the renderer store — this is the split-brain
  identity fix), microphone-leak-on-unmount fix in `use-audio-capture.ts`
  (there's already a correct pattern in `use-jarvis-turn.ts` to copy).

## Phase 2 — Communications translator gaps (serialize the shared file)

One worker at a time on `dobiusCommunications.ts` itself, in this order
(each is a clean commit before the next starts, to keep the shared-file risk
low) — but the *backend* investigation for each group can happen ahead of
time / in parallel, since that's mostly reading other files:

1. Canvas notes (2 commands) + archive save-subscriptions (5) + social/notes
   (7) — smallest, most self-contained group, do first to prove the pattern.
2. Channel templates (5) — needs a backend CRUD store; check if one already
   exists before building new.
3. Workflows (8) — `workflow-executor.ts` already exists with 3 of its step
   types working; this is about the *listing/CRUD* commands around it, not
   the executor itself.
4. Mesh/pairing (9) — verify how much real backend exists before scoping;
   may be bigger than a single-session task.
5. Agent/team snapshots (9) — export/import flows, likely real crypto/file
   work in main.
6. Projects/git (18) — the largest single group. Dobius already has its own
   git service (`GitView`, `git-service.js` per the root CLAUDE.md) — check
   whether these commands can route through existing git plumbing before
   building new.
7. Huddles (18 commands) + Hosted Communities (13) — these are the
   *structural bypass* group (raw `@tauri-apps/api/core` calls, not just
   missing cases). Huddles already have translator cases; the fix here is
   rewiring the call sites to use `invokeTauri`, not writing new backend.
   Hosted Communities has neither a case nor backend — bigger scope, do
   last or split into its own follow-up.

## Phase 3 — Real code gaps found by direct reading (small, independent)

- Peer-scoped NIP-44 decrypt/control (`dobiusCommunications.ts:3106-3116`)
  — blocks agent observer flows.
- Orphaned `communications:identity:signOut` IPC handler — either wire a
  real sign-out button to it, or remove it if genuinely unused.
- Workflow executor's remaining step types (agent-dispatch, HTTP call,
  approval gate) — extends the existing honest-skip implementation.

## Phase 4 — Build/release health (independent, low risk)

- `dobius` CLI userData path-casing mismatch (the manual-symlink workaround
  — needs a real fix, separate from tonight's build-order bug).
- Split `App.tsx` out from under its `max-lines` lint disable (house rules
  forbid that disable) — mechanical refactor, no behavior change.
- Cap the localStorage screenshot quota risk (data-URI screenshots, no size
  limit today).
- Sweep the 194 hardcoded hex colors outside Communications components into
  CSS variables (house rule: no hardcoded hex).

## Needs your call before anything gets dispatched

- **Floating-orb window** (`floating-orb-window.ts`): finish deleting it
  (route, `BrowserWindow`, IPC alias) since nothing calls it anymore, or
  restore a caller? Also needs the wake-word settings copy fixed either way.
- **`ClaudeAgentSdkProvider`**: dead code today (only tests construct it).
  Delete it, or is it meant to become the real backend for one of the
  "any-provider harness" phases?
- **ADAM plugin system security model**: plugins in `userData` (no rebuild,
  but unsigned code runs in main process) vs. plugins in the repo (safer,
  needs a rebuild). Your call, not mine to default.
- **Developer ID signing / notarization**: needs your Apple Developer
  credentials on this machine or a provisioned `CSC_LINK`/`APPLE_TEAM_ID` —
  can't proceed without those regardless of what gets built.
- **Second Communications chat-logic copy** (`src/main/communications/chat/*`,
  7 files + tests): flagged as possibly dead by the docs audit, not yet
  confirmed. Worth a quick read before Phase 2 touches anything nearby, in
  case it's actually the thing some Phase-2 commands should route through.

## Not scheduled here (explicitly out of scope for this pass)

Business OS / Dashboard / Kanban (planning-only, no build started anywhere),
the headless auto-mode conductor (paused on purpose), computer-use's bigger
feature gaps (OCR, multi-monitor, app launch/window management — new
feature work, not a fix), and the Business-OS-adjacent Crew/Asana automation
phases. All still listed in the punch list for later.
