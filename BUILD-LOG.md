# Build Log

## 2026-07-30 — Buzz tab + Buzz app skin (feat/buzz-skin)
- Cloned github.com/block/buzz, traced its design system (theme.css + tailwind.config).
- New Buzz tab in the sidebar opens a recreation of the Buzz workspace UI (BuzzPage.tsx).
- New Buzz App Skin repaints all of Dobius+ with the Buzz gradient look (buzz-skin.css).
- typecheck 0, oxlint 0, app-skin tests 6/6. 16 pre-existing hook-test failures confirmed unrelated (fail on clean tree too).
- Verified in dev app via CDP screenshots, light + dark. Committed locally; not pushed (local-first).

## 2026-07-30 (late) — Buzz Phase 0 complete
- All 4 wiring reports delivered + saved to Docs/Buzz-Takeover/wiring-reports/ (relay core, ACP harness, agent toolkit, UI shim surface).
- Colima + Docker up; buzz fork cloned to ~/Projects (Code)/buzz (remote=upstream); just setup green (postgres/redis/minio healthy, migrations applied).
- buzz-relay compiled (6m19s) and running detached on port 3300 (3000 was pocket-cologne preview — left untouched). RELAY_URL=ws://localhost:3300; BUZZ_AUTO_MIGRATE=true; using dev signing key (local-only; set BUZZ_RELAY_PRIVATE_KEY before any network exposure).
- Buzz.app launched with BUZZ_RELAY_URL=ws://localhost:3300 — connected, authenticated, posting events (HTTP bridge 200).

## 2026-07-31 — Phase 3 smoke PASSED: first Claude agent live in Buzz
- buzz-cli/buzz-acp/buzz-admin built (3m20s). claude-agent-acp v0.64.0 installed (speaks protocol v1 → legacy framing, works; token-heavier, revisit).
- Agent "Scout" born: key in ~/.config/buzz-agents/scout.env (chmod 600), profile set, created open channel #agent-lab, cwd pinned to ~/dobius/projects/buzz-agent-workspace.
- Harness pool running (respond-to anyone). Tester identity mentioned @Scout; Scout replied in-channel with a real Claude-generated answer including its correct pinned cwd. Text-an-agent loop VERIFIED end to end (verified by reading the actual channel message, not logs).

## 2026-08-24 — Phase 0: comms hub installed and live (feat/comms-hub-openbot)
- Gate 19/19 exit 0; full build green after two env fixes: (1) Swift PCH cache held the pre-move repo path — rm -rf native/computer-use-macos/.build; (2) afterPack verifier flagged node:sqlite (missing from builtinModules on Node 22.22/26.0.0) — allowlisted in config/packaged-runtime-node-modules.cjs; proven safe (installed app already ships it).
- scripts/install-dobius-v2.sh: replaced stale hardcoded REPO (pre-move path) with derived path.
- Installed with daemon UNTOUCHED: PID 1477 before == after; relay LISTENING on 127.0.0.1:3300, /query validates (semantic error = live stack). Lesson: repo moved to .../Dobius/dobius-plus — any hardcoded old path rots (PCH, installer).

## 2026-08-24 — Phase 1: 54 unreachable comms commands wired + proven (method seam)
- Allowlist: +50 methods in src/shared/communications-bridge.ts (workstationGit/media/snapshot/workflow/channelTemplate/saveSubscription families).
- Gateway: handler extracted (createCommunicationsBridgeHandler) so the harness drives the REAL pipeline (trust check + allowlist + dispatcher) — the vendor seam bypassed all of it.
- Harness: ScenarioStep.via ('vendor'|'method'); createGatewayMethodInvoker; electron mock gained honest safeStorage (isEncryptionAvailable:false); node:os homedir mocked to tmp — CRITICAL LEAK FIXED: participant-identity store uses ~/.dobius (real home!), harness was reading the user's live encrypted identity and could have overwritten it with a plaintext test identity.
- 5 new family scenario files (53 steps, 52/55 methods; 3 honestly omitted: checkPipelineHotstart needs un-stubbed runtime, 2 media pickers are GUI). New stricter gate: every method-seam step must PASS — no escape hatch.
- scripts/run-comms-gate.sh: quits app (daemon survives), runs gate on 3300, relaunches; hardens with installer-proven exact-name kill + holder-naming aborts.
- Gate: 21/21 exit 0 (19 vendor-seam + 2 method-seam). typecheck:node exit 0.
- Lessons: capture runs AFTER shapeCheck (set ctx keys in args builders); post-merge 3-dot diffs only show what the target gained; verify/ dir is excluded from tsconfig.node.json so the GATE is its only typecheck — type errors there surface only at run time.

## 2026-08-26 ~03:20 — Phase 4: Native Communications cutover (commit fdcffaaf)
- Gate green 21/21 with zero vendor imports (direct core world + method seam + real-relay AUTH).
- Main window now mounts BuzzNativePage; communications preload exposed to main window; gateway trusts the app renderer surface (communications-surface.ts).
- Identity migration (webview partition -> participant store) + kind-0 profile publish landed with 12-test decision table.
- RelayStatusNotice (fail/retry) in native client, 6 tests.
- vendor/buzz-desktop (400MB) + webview host components deleted; build scripts/installer/verify configs swept.
- Installer now rm -rf's dist/mac-arm64 post-install (LaunchServices duplicate-icon prevention).
- Installed to /Applications, relay live (3300), daemon survived install.
- Lesson: full-volume `lsregister -r` rescans are read-only but scary (sync-tool popups); targeted `-u` + one rebuild is the right tool. Also: `find -maxdepth` missed copies on /Volumes — use mdfind + exact-path probes for app-instance hunts.
- Pre-existing failure noted (not ours): register-core-handlers.test.ts missing electron mocks (fails at HEAD).

## 2026-09-03/04 — computer-use-v2 + comms-hub-restore merge, DM fix, CLI build-order root cause
- Merged `feat/comms-hub-restore` (31 commits, full Communications restoration) into `feat/computer-use-v2` (the active branch). Reconciled 12 conflicting files against a research agent's verified per-file recommendations (took comms-hub-restore's versions for `custom-harness-provider.ts` — it fixed 2 tests that were actively failing on computer-use-v2). `buzz/native/` (the earlier from-scratch rewrite) retired per Carson's explicit decision to keep the full restored app instead.
- Fixed silent merge duplication in `preload/api-types.ts` (both branches inserted an identical 6-method type block at different anchors — TS2300 duplicate identifier, not caught by git's line-based merge).
- Fixed a real, un-tracked build gap: `dobius/src/renderer/src/components/communications/tailwind.config.js` — hand-authored theme config that `.gitignore`'s `src/**/*.js` rule was silently swallowing; only "worked" because it happened to sit uncommitted on disk in one worktree all session. Added a negation exception + committed the file.
- **DM persistence bug, root-caused and fixed:** `loadRelayChannels()`'s "drop nameless metadata rows" filter (added earlier the same session to stop duplicate-channel pollution) also dropped every DM, since `relay-dm.ts` provisions DM channels with no `name` tag by design. DMs vanished on every tab-switch/restart re-fetch. Fixed: filter now exempts `channel_type === "dm"`.
- **LaunchServices fix:** `scripts/install-dobius-gated.sh` now force-refreshes LS registration and warns on any duplicate bundle-ID copy found elsewhere on disk, on every install.
- **The `dobius` CLI was completely broken** (`MODULE_NOT_FOUND` on every command) — root-caused across three build attempts, the last one contested and re-verified against a parallel Claude session actively editing the same checkout tonight:
  1. `out/cli/index.js` was building fine but vanishing before packaging — traced to electron-vite's multi-target build.
  2. A second, independent collision: `managed-agent-hook-controls.ts` is compiled by BOTH tsc (`tsconfig.cli.json`, for the CLI) AND Rollup (declared as its own entry in `electron.vite.config.ts`, for the main process) to the identical output path — whichever ran last won, and tsc's 119-line stand-in breaking real terminal creation is what a parallel session found and fixed with the opposite ordering to mine, which is what actually surfaced the full scope of this.
  3. Root cause, fully resolved: electron-vite's "main" Rollup target empties the ENTIRE `out/main/` directory before writing its own bundle — every one of the ~15 `out/main/<provider>/` dirs the CLI needs (asarUnpack list) is produced ONLY by tsc, so `build:cli` must run LAST, full stop — but that makes tsc clobber Rollup's one correct file (managed-agent-hook-controls.js) instead. Fixed with `config/scripts/preserve-rollup-hook-controls.mjs`: snapshot Rollup's version right after `build:electron-vite`, restore it right after `build:cli` overwrites it. Verified in 3 separate fully-isolated builds (no concurrent build racing) with a live file-presence watcher before shipping.
- Lesson: **two Claude sessions actively building/installing the SAME checkout concurrently will corrupt each other's diagnosis, not just each other's files** — my first "out/cli gets wiped" finding was itself contaminated by a parallel session's concurrent `rm -rf out` racing with my own "isolated" test. Always `pgrep -f "electron-builder|electron-vite|vite build|tsc -p"` for zero BEFORE trusting any build-order finding as deterministic.
- Also fixed: 7 agent-provider directories (`amp`, `codex-accounts`, `command-code`, `devin`, `kimi`, `openclaude`, `runtime`) missing from `asarUnpack` entirely — packed in the asar but never unpacked, so the CLI couldn't `require()` them. Locked in with a regression test (`packaged-cli-assets.test.ts`).
- Dispatched 6 parallel workers via `dobius orchestration` (fresh worktrees off `feat/computer-use-v2`, each with a disjoint file set to avoid the exact collision class above): security fixes (main + renderer, split to avoid file overlap), the App.tsx 2,777-line split, Communications translator gaps (7 groups, serialized within one worker since they share one file), and 2 smaller Communications code gaps. Full handoffs, not supervised — review/audit/ship-test pipeline to run once each reports back.
- Open, not yet root-caused: "channel conversation gets wiped, shows in Inbox instead" — strong lead (NIP-42 auth handshake on the relay's live WebSocket subscription has a 25s timeout with no confirmed-working resolve path; Inbox uses an independent fetch so it keeps working even if the live channel connection never completes) but unconfirmed live — renderer console isn't reachable without DevTools/CDP, not enabled on this build.

## 2026-09-04 (late) — Task COMMS.1: channel/DM live view going silent, root-caused and fixed
- Confirmed the prior session's open lead above: `relayClientSession.ts`'s `connect()` awaited the NIP-42 AUTH handshake promise before `replayLiveSubscriptions()`/returning, so `ensureConnected()` (and every `subscribe()` waiting on it) blocked for up to `AUTH_TIMEOUT_MS` (25s) with the channel/DM view receiving nothing — no error, no indicator. The relay server never actually gates REQ/EVENT on this handshake (client-side-only gate). Fixed by letting AUTH run in the background instead of blocking; `subscribe()`'s REQ now sends immediately after WS open.
- Verified with a real `ws`-server unit test in `relayClientSession.test.mjs` that reproduces the exact symptom against the old code (hangs, `test timed out after 5000ms`) and passes in ~300ms against the fix. Vitest doesn't actually execute this file's (or several other pre-existing `@comms/**/*.test.mjs` files') async `node:test` bodies — confirmed pre-existing via `git stash` bisection, flagged in `HANDOFF.md` for a human decision, not fixed (out of scope). Verified manually with a throwaway Node loader instead.
- Also applied the agent-identity-registry decrypt-failure self-heal (already shipped in commit `7bb42000`) to the OWNER'S identity store, `participant-identity-store.ts`, which had the identical unguarded `safeStorage.decryptString()` failure mode.
- Fixed `scripts/verify-task.sh`'s suppression-comment gate: it was a repo-wide grep for `@ts-ignore`/`eslint-disable` across all of `dobius/src/`, which already has 117 pre-existing `eslint-disable` and 2 `@ts-ignore` from before this build — failed identically for every task regardless of content. Rescoped to the task's own commit diff.
- Attempted an autonomous background run via `scripts/crackbot-supervisor.sh` first; it was killed with zero work done (background task output was just `[killed]`/`Execution error`, confirmed via git log showing no new commits). Proceeded by doing the PLAN→IMPLEMENT→VERIFY→REVIEW→COMMIT→GATE→LOG cycle directly in-session instead.
- Commits: `fe7d8fb9` (fix), `67f09f2c` (gate-script fix).

## 2026-09-04 (late) — Task COMMS.2: agent messages always show a real name
- Root-caused both triggers from `IRIS-REPORT-20260904.md`: (1) an agent's kind-0 profile publishes lazily on its first reply, so `profiles` has no entry yet on first render; (2) `loadDobiusManagedAgents()` drops an agent entirely from its returned list when that agent's own pubkey lookup rejects out of `agentPubkeysById()`'s `Promise.allSettled` batch.
- Fix: new `agentNameByPubkey` fallback tier in `resolveUserLabel` (`identity.ts`), inserted before the truncated-pubkey fallback. Sourced from `ChannelScreen.tsx`'s already-in-hand `managedAgentsQuery.data` (a separate query lifecycle from whatever failed for trigger 2, so it often still has the name). Threaded as a new optional trailing param through `formatMessageAuthor`/`formatTimelineMessages`/`useIndependentThreadPanel` rather than reusing the existing `personaLookup` map, which `SystemMessageRow.tsx` already uses presence-of-key from to mean "has an assigned persona" — widening it would have silently changed that unrelated check for every agent without a persona.
- 5 new unit tests (4 in `identity.test.mjs`, 1 integration-level in `formatTimelineMessages.test.mjs`), all passing (37/37 in both files combined) verified via the same throwaway Node loader from COMMS.1.
- Commit: `551eb21d`.

## 2026-09-04 (late) — Task COMMS.3: Huddle button now explains why it's disabled
- The plan's file:line references were stale — traced the real Tooltip wrapper and mic-permission handling one layer down from `ChannelMembersBar.tsx` into `HuddleIndicator.tsx`, which it renders.
- Fix: new `huddleStartDisabledReason()` pure function in `huddleAvailability.ts` ("Members list is still loading" while `useChannelMembersQuery` is pending, "You're not a member of this channel" once resolved and `selfMember` is still null, `null` once enabled), threaded through `ChannelMembersBar.tsx` → `HuddleIndicator.tsx`'s tooltip content.
- Investigated the plan's membership-resolution hypothesis (pubkey-casing/tag mismatch): traced `selfMember` lookup (normalizes both sides), the backend's kind:39002 tag parsing (`loadDobiusChannelMembers`, consistently lowercased), and channel creation (`createDobiusChannel` always adds the creator as `"owner"` before the first membership event publishes). Found no bug in the code — could not verify against Carson's live relay data (no DevTools/CDP on this build; a fresh install is out of scope for routine per-task verification per this build's own disk-space guardrail). Flagged as owed in `HANDOFF.md`.
- Confirmed (no code change needed) that a `getUserMedia` failure once the button IS enabled already surfaces a visible Sonner toast via `formatHuddleActionError`, not a console-only failure — traced the full re-throw path through `HuddleContext.tsx`'s `startHuddle()`.
- 3 new unit tests for `huddleStartDisabledReason`, all passing (8/8 combined with pre-existing `canStartHuddleInChannel` tests).
- Commit: `b0923feb`.

## 2026-09-04 (late) — Task COMMS.4: discoverable per-channel Delete/Leave (BUILD COMPLETE)
- Traced the sidebar component tree before trusting the plan's diagnosis: `ChannelGroupSection`/`CustomChannelSection` already wrap every channel row in a right-click `ContextMenu` whose content (`ChannelContextMenuItems`) already has working, already-wired "Delete channel" (real moderation-capability gate) and "Leave channel" — reachable by right-click, already end-to-end. The actual gap was discoverability: the row itself gives no visible hint right-click does anything, and the only visible "⋮" (the section-header one) is section-scoped by design.
- Fix: `ChannelRowActionsMenu.tsx` — a hover-revealed action button using the shadcn `SidebarMenuAction` primitive (already shipped in this codebase's UI kit, `showOnHover` built in, unused anywhere until now). Opens a small dropdown with the same "Leave channel"/"Delete channel" items, reusing the exact same handler props and `useChannelModerationCapabilities` gating the right-click menu already uses — no parallel reimplementation, no permission-check duplication.
- Extracted into its own file rather than inlining in `CustomChannelSection.tsx`, which was already 761 lines (over its 400-line oxlint cap) before this task touched it — kept that file's net growth to +11 lines.
- Commit: `768c7dc1`.
- **All 4 Communications Hub tasks now done.** Two live-verification items still owed (both need a build+install, out of scope for this build's routine per-task gate) — see `HANDOFF.md` for the full list. One pre-existing test-infrastructure gap surfaced during COMMS.1 (async `@comms/**/*.test.mjs` files don't actually run under this repo's real `pnpm test`) — also flagged there, not fixed, out of scope.

## 2026-10-23 00:30–04:30 — Board (Symvibe-style canvas) built into Dobius+ V2
- Branch `aiimitch38-create/agent-canvas` (from 1c5c9e07). Orchestrated: Builder 1, Builder 2, Studio A, Studio B/Visual QA, Design Lead, Reviewer, Capture engineer (Claude) + 2 OpenCode GLM tabs; subagents for research/capture.
- Built: Board as default view (Classic one click away), canvas + rails + side-apps dock + command bar (VoiceOrb), live console cards (portal, fixed columns on zoom), typed planner + delivery gate + mission reports, pause/resume agents, cards (15 kinds), studios (9), presets, loops (schedule/idle/output/goal/templates), undo/redo, shortcuts, context menu, styles. Details: dobius/docs/board/MORNING-SUMMARY.md.
- Verified: typecheck web clean; 6,328 tests pass; the 24 failing tests fail identically on 1c5c9e07 (pre-existing); hook checks run by hand (hook not installed in worktree).
- Lessons: long `dobius terminal send` messages lose their start — send briefs as files; `--wait --json` output needs heartbeat filtering (learned skill); UI crawlers on a real app must deny-list spawn/add/copy/settings and never use Cmd+Z off the canvas; swap can eat 1 GB+ disk under many agents — watch `df`.

## 2026-10-25 — 2.1.1 → 2.1.3 (installed 2.1.3, build 49, 5c94e879)
- 2.1.1: no Classic flash (Board cover until hydration, Suspense cover, prefetch, no-workspace → Home).
- 2.1.2: Settings/Automations/Tasks/Skills/Mobile open as studios from Home.
- 2.1.3: web tiles (allowpopups + popup → sibling tile, rate-limited; private dobius-web-tile session by default; overflow-clip; focus-fly fixed), consoles (glance kept until live paint; agent exit → Ended + Restart; lead watcher two-poll rule), perf (glance tail backoff/seq skip; renderer idle CPU ~170% → ~9% with 6 consoles).
- Lessons: settled-state screenshots miss transition flashes (frame bursts added to the test-copy skill); in Electron 42 a webview's getWebContentsId() throws until dom-ready; a test-copy agent that dies with the session leaves an orphan Electron (check pgrep after interruptions); a missing `allowpopups` silently drops window.open before main's handler.
