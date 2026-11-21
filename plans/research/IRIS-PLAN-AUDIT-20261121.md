# Investigation Report: Workstation Build Plan vs the real code (2026-11-21)

Target: `~/Projects (Code)/dobius-plus/WORKSTATION-BUILD/plans/WORKSTATION-BUILD-PLAN.md`, checked against `WORKSTATION-BUILD/dobius/src` at branch `aiimitch38-create/workstation-build`, HEAD `20a74b78`.
Method: read-only. Every "verified" row was checked by reading the file or the commit in this session. Nothing was built, run, or launched. No test suite was run, so any "this test fails" claim is marked unverified unless the code itself proves it.
Paths are relative to `dobius/src/` unless they start with `~` or `dobius/`.

## Summary

The plan is mostly pointing at the right places, but it is out of date in five ways that would waste agent time. First, its header still says "nothing built yet" while seven items are finished and committed. Second, Phase 9 says the command line has no `dobius board` command, but one already exists (`dobius board consoles` lists every console card with its name and tab id), so 9.1 and 9.2 are small add-ons, not new builds. Third, several of "Sam's features" in Phase 1 already exist in this app under other names: a "Found a bug?" button with screenshots, question cards in chat, folding of tool calls, links opening in the normal browser, a Restart menu item, and crash recovery for a blank window. Fourth, the plan lists most late items twice (Phases 2 to 7 and again in Phase 8) and reuses the numbers 8.1 to 8.4 for two different things. Fifth, a handful of file and line references have drifted. The famous "164 failing tests" are real in cause: the tests hand the code an empty value (`null`) where the code now expects to be told which app window is asking, a safety check (a "sender gate": code that refuses requests that do not come from one of the app's own windows) added on 2026-10-27. The fix is a mechanical find-and-replace in one test file. I did not run the suite, so the exact number 164 is unverified.

## Key Findings

1. **`dobius board` CLI already exists.** `cli/specs/board.ts:6,34,42,58` defines `board spawn-console`, `board consoles`, `board open-tile`, `board agent-control`. The RPC (remote procedure call: the app-side function the command line talks to) `board.listConsoles` is at `main/runtime/rpc/methods/board-consoles.ts:200-207` and returns `id, tabId, title, role`. It lacks the live terminal handle and a running/not-running flag. Severity: high (plan Phase 9 premise is wrong).
2. **pty test failures are a test-fixture problem, not a product bug.** `main/ipc/pty.ts:2769` reads `event.sender` (gate added in `f5e57ecd`, 2026-10-27). `main/ipc/pty.test.ts` calls `handlers.get('pty:spawn')!(null, ...)` 118 times, so `null.sender` throws before any assertion. Commit `9ea3c633` added the same gate to kill / getSize / listSessions / hasChildProcesses / getMainBufferSnapshot (`pty.ts:3830-3987`) and the test still passes `null` to those 12 times. A trusted event already exists in the test: `mainWindowIpcEvent` at `pty.test.ts:256`. Severity: medium.
3. **Report-a-problem already exists on the board.** `renderer/src/components/board/board-chrome/BoardFoundBugButton.tsx` (mounted `board/BoardPage.tsx:170`) opens `BoardReportDialog.tsx`, which captures a window screenshot (`:152-165`) and creates a Kanban card via `shared/app-feedback.ts:46`. Plan items 1.1, -1.7 and Phase 5 should extend this, not build beside it. Severity: high.
4. **Design-system submodule is not checked out here.** `dobius/design/` is an empty folder; `git submodule status` shows `-3d19fc8c dobius/design` (the leading `-` means "not downloaded"). Item 3.3 cannot start until it is. Severity: medium.
5. **Phase 8 duplicates Phases 2-7, and "Later" reuses IDs 8.1-8.4.** Two rows per feature means two agents can be handed the same work. Severity: medium.
6. **Stale lint and translation allowlists are confirmed.** `dobius/config/lint-baseline.json:207,253,520,848` and `dobius/config/localization-coverage-allowlist.json:8193-8298` still name deleted files. Item 0.7 is real and open. Severity: low.
7. **Knowledge view is half-wired.** The store has `openKnowledgePage` (`renderer/src/store/slices/ui.ts:1541-1546`) but nothing calls it and `AppWorkspaceShell.tsx:304-314` has no `'knowledge'` branch. The backend is NOT unused, though: the board's Memory studio reads it (`board/board-studios/ProjectKnowledgePanel.tsx:57,185`). Severity: low.

## Architecture Map (only what the plan touches)

- **Main process** (`main/`, the background half of the app with full computer access): PTY handlers (`ipc/pty.ts`, 4,031 lines), runtime (`runtime/dobius-runtime.ts`, 24,541 lines), agents (`agents/`), bridges (`imessage-bridge/`, `telegram-account/`), tasks (`vertex/`, `ipc/vertex-tasks.ts`).
- **Preload** (`preload/index.ts`, 4,681 lines): the narrow doorway the window uses to call main.
- **Renderer** (`renderer/src/`, the window): board (`components/board/`), native chat (`components/native-chat/`), page switch (`components/app-shell/AppWorkspaceShell.tsx`).
- **CLI** (`cli/`): `specs/*.ts` declare commands, `handlers/*.ts` run them, both talk to `main/runtime/rpc/methods/*.ts`.
- Board card to terminal mapping is saved UI state (`ui.boardsByWorktree`), already readable from main (`board-consoles.ts:93-116`, `main/automations/board-group-members.ts:24`).

## Audit table (every plan row)

Status words: **done** = in code and committed; **partly** = some of it exists; **not started**; **plan wrong** = the row's premise or anchor is wrong. Confidence: V = verified by reading code/commit this session; I = inferred; U = unverified.

### Phase -1

| Plan ID | Plan says | Code says (status) | Real anchor file:line | Problems / conflicts | Lag / blocker | Conf. |
|---|---|---|---|---|---|---|
| -1.1 | DONE, security fixes brought over | done | commit `9ea3c633` (9 files: `main/ipc/pty.ts`, `ipc/worktrees.ts`, `cloud-backup/controller.ts`, `external-backup-sources.ts`, `dobius-cli/dispatch-server.ts` + tests) | Mapping to issue numbers #6/7/8/27/30/32 is unverified (commit message does not name them). Commit says "pty tests now pass trusted senders" but 130 calls still pass `null`. | none | V |
| -1.2 | DONE except live check | done in code | commit `a238c856`; `renderer/src/components/board/board-route/board-reset.ts:62-76` | Fix only covers `activeWorktreeId === null`; see -1.14 | live-app check | V |
| -1.3 | Test Restart live | not started (test task) | menu `board/board-chrome/BoardAccountMenu.tsx:75` -> `main/ipc/app.ts:294-303` (`app:restart`) | Blocked by the workspace-switch wipe bug if the test hops workspaces | live-app check | V (anchor) |
| -1.4 | Merge hibernation fix `a0b689fc` | not started | not an ancestor of HEAD; touches `renderer/src/lib/agent-hibernation-planner.ts`, `store/slices/terminals.ts` + 3 tests | `git merge-tree` reports a clean merge. Branch also carries `b367e308` (docs). Same area as the wipe bug (terminals slice): coordinate with that agent. | none | V |
| -1.5 | Failing test "closing the studio returns to Home" | test exists; failing state unverified | `renderer/src/components/board/board-home/BoardHome.test.tsx:137-146` | Not run | none | U |
| -1.6 | Install A-menu + Reset | not started | n/a | Should wait for -1.3, -1.14 | Carson's OK | I |
| -1.7 | A menu "other things": Usage, Report a problem | partly: both already reachable elsewhere | Menu items today: Accounts, Restart, Reset (`BoardAccountMenu.tsx:128-139`). Usage = `BoardUsagePill.tsx` / `BoardUsagePanel.tsx`. Report = `BoardFoundBugButton.tsx` at `BoardPage.tsx:170` | Adding them to the menu duplicates existing entry points | Carson's decision | V |
| -1.8 | Remaining security items | not started | `main/computer/action-decision.ts:91-101` (risky check keys only on `elementIndex`, so x/y clicks skip it: confirmed); `main/runtime/runtime-rpc.ts:785` (`host: '0.0.0.0'`: confirmed, also `:904`) | #10-#35 not individually checked. Main-process + phone pairing = risky area | L; phone items need a real device | V for #4/#5/#9, U rest |
| -1.9 | Stranded Line B commits | not checked | branches exist locally: `integration/mobile-terminal-repairs`, `feat/hostinger-integration`, `feat/adam-voice-control` | Needs `git cherry` per branch | M, long chain | U |
| -1.10 | Round2: remove "Panels" rail button | not in this copy | button still present: `board/board-chrome/BoardSideApps.tsx:46,198` | "broken" claim unverified | live-app check | V (presence) |
| -1.11 | $10 spend caps | not in this copy | default 0.5 at `main/agents/agent-record-normalization.ts:20`, clamp max 2 at `:65`; channel runs 1 at `agent-channel-service.ts:150` | none | Carson's decision | V |
| -1.12 | DONE, BUILD-LOG entry | done | commit `1684063d` | none | none | V (commit exists; file text not re-read) |
| -1.13 | 164 pre-existing pty test failures | cause confirmed, count unverified | gate `main/ipc/pty.ts:2769` (from `f5e57ecd`, 2026-10-27) + `:3542-3546` and `:3830-3987` (from `9ea3c633`); test `main/ipc/pty.test.ts` passes `null` 118x to spawn, 12x to the newly gated handlers; trusted event at `:256` | Fails with a TypeError on `null.sender`, not with "Unauthorized". `spawnAndGetEnv` helper (`:662`) likely passes `null` too. Fix = replace `null` with `mainWindowIpcEvent`. | S, not S-M | V cause, U count |
| -1.14 | Reset can land on editor/browser tab | open | `board-reset.ts:62-76`; `closeTerminalTab` imported `:1`, called `:38` | Same file as -1.2 | live-app check | V |
| -1.15 | Bare `{ }` block in cloud-backup controller | open, confirmed | `main/cloud-backup/controller.ts:130` | none | none | V |

### Phase 0

| Plan ID | Plan says | Code says | Real anchor | Problems | Lag | Conf. |
|---|---|---|---|---|---|---|
| 0.1 | DONE remove Mesh Compute | done | `390773a6`; `features/mesh-compute/` and `shared/api/tauriMesh.ts` gone | Leftovers: `lint-baseline.json:253,848`; mesh test stubs in `communications/testing/e2eBridge.ts:1127,2885,9810` | none | V |
| 0.2 | DONE remove Hosted Communities card | done | `390773a6`; `HostedCommunitiesSettingsCard.tsx`, `HostedCommunityOnboarding.tsx` gone | `HostedCommunityCreateFlow.tsx` + `hostedCommunityApi.ts` kept on purpose (still imported). Leftovers in both allowlists. | none | V |
| 0.3 | PARTLY DONE, 10 files | partly | `ef66d69c`; list in `plans/algorithm/TASK-02-deleted.md` | 870 non-test source files remain under `communications/features/` | none | V |
| 0.4 | DONE in code, not smoke-tested | done in code | `main/dobius-cli/install-clis.ts:149-185` (plan says 140-167); routes `dispatch-server.ts:298-310` (correct) | none | live-app check after install | V |
| 0.5 | Research Sam's voice work on origin | not started | `feat/adam-voice-control` exists locally and on the **fork** remote, not origin | TASK-04 says "search origin branches": it will miss this branch | none | V |
| 0.6 | Delete whole dead chains | not started | `renderer/src/components/communications/features/**` | Needs an entry-point reachability script; `.test.mjs` files keep dead code "referenced" (e.g. `useBotRecents.ts`) | M | I |
| 0.7 | Remove stale config entries | not started, confirmed needed | `dobius/config/lint-baseline.json:207,253,520,848`; `dobius/config/localization-coverage-allowlist.json:8193-8298` | Deleting the e2eBridge mesh mock may break the relay-mesh test harness (TASK-01-03 report says it is still used) | none | V |
| (0.x note) | Delete candidates needing OK | mixed | `components/operations/OperationsDashboard.tsx`: 0 importers (only a comment in `agents-hub/AgentsOverview.tsx:3-4`). `stats/UsageSessionsTable.tsx`, `StarNagToastHost`, `RepoStep`, `LinearAgentSkillSetupPrompt`: 0 import statements found. **`CreatePullRequestDialog` and `FeatureTourPreview` have importers** (`communications/features/projects/ui/ProjectsView.tsx`, `onboarding/OnboardingTourStep.tsx`). `main/ipc/communications-identity.ts` is registered at `main/ipc/register-core-handlers.ts:260` with no preload entry. | Two of the named "orphans" are not orphans (or share a name with a live file: check each path) | Carson's OK per item | V / I |

### Phase 1 (Sam ports)

| Plan ID | Plan says | Code says | Real anchor | Problems | Lag | Conf. |
|---|---|---|---|---|---|---|
| 1.1 | Port Report a problem | **already exists** (board button + dialog + screenshot + Kanban card) | `board/board-chrome/BoardFoundBugButton.tsx`, `BoardReportDialog.tsx:152-165`, `shared/app-feedback.ts:46`, `main/ipc/feedback.ts:191`, `sidebar/SidebarFeedbackDialog.tsx` | Only "send through a linked teammate" is missing, and that needs 1.4. DECISIONS round 4 folded this into Phase 5, but the plan text still says "then 1.1". | none | V |
| 1.2 | Port Phone mode | not checked in depth | this app has its own phone stack (`components/mobile/`, `main/runtime/runtime-rpc.ts`) | Port vs existing phone app: design conflict | L, needs device | U |
| 1.3 | Port iPhone share sheet | not found | no match | none | M, needs device | I |
| 1.4 | Port Team linking / Windows | not found | source branches exist: `origin/feat/team-cross-tailnet`, `origin/feat/team-cli-windows` | L; needs Tailscale + a second machine | L, external | I |
| 1.5 | Port chat folding + question cards | **mostly exists** | `renderer/src/components/native-chat/native-chat-tool-fold.ts`, `NativeChatToolRun.tsx`, `NativeChatQuestionCard.tsx`, `NativeChatInteractiveCard.tsx`, `shared/native-chat-ask-types.ts` | Folding here is per tool run; "fold older turns" may differ. Compare against PR #24 before building. | none | V (exists), I (parity) |
| 1.6 | Port auto-resume, links in browser, blank window recovery | **mostly exists** | links: `openLinksInApp: false` default `shared/constants.ts:280`, prompt dialog `components/link-routing-preference-dialog.tsx`; blank window: `main/window/createMainWindow.ts:651` + crash-loop stop `main/index.ts:1135`; restart: `main/ipc/app.ts:294` | "Every tab back" depends on -1.3 live test | live-app check | V (exists) |
| 1.7 | Port release safety checks | plan contradicts itself | n/a | The list above the table says "Skip: #20, #22, #23". Table row should be deleted. | none | V |
| 1.8 | Port preflight primer | superseded | branch `aiimitch38-create/agent-preflight-primer` exists | DECISIONS round 4 + Phase 8 intro fold this into 3.2, but Phase 1 still says "Order: 1.8 first". Delete row. | none | V |
| (list) | Snooze tabs, My Day, What's new | Snooze tabs: not found (only chat reminders `communications/features/reminders/ui/SnoozeMenu.tsx`). My Day: not found. What's new: partly, `components/UpdateCard.tsx:103,134,298` shows release notes when an update is offered | n/a | These three are the real remaining ports | M each | V |

### Phase 2

| Plan ID | Plan says | Code says | Real anchor | Problems | Lag | Conf. |
|---|---|---|---|---|---|---|
| 2.1 | Graphify every project | not started | binary present at `~/.local/bin/graphify`; no `graphify-out/` in this checkout | Open conflict with the "no third indexer" rule (Appendix D.6). DECISIONS simplified to one repo. | Carson's decision | V |
| 2.2 | Event log + proof-of-done | partly | proof attachments exist: `shared/vertex-task-types.ts:107-122`, `cli/handlers/tasks.ts:126-143` (`tasks complete --proof`). No rule that Done requires proof was found in the store. Run journal exists: `main/agents/agent-run-event-journal.ts:87-108` | Duplicate of 8.1. Persistence = risky | L | V / I |
| 2.3 | Postcheck + retry loop | not started | no "postcheck" anywhere. Anchors correct: `main/automations/run-lifecycle.ts:70` (`settleHeadlessCompletion`), `main/agents/agent-runner.ts:183-201` (stream loop), resume `:387-390`, `main/automations/precheck-runner.ts` (269 lines) | Same file as 4.2 and 4.1 (`agent-runner.ts`): do not run in parallel | M | V |

### Phase 3

| Plan ID | Plan says | Code says | Real anchor | Problems | Lag | Conf. |
|---|---|---|---|---|---|---|
| 3.1 | Loading screen from demo | not started | terminal pane; note `AppWorkspaceShell.tsx:291-294` records "Deliberately no loading UI (Carson's call, 2026-09-02)" for pages | Duplicate of 8.2. DECISIONS says a status line unless the brief takes over 1 s | needs the artifact (external link) | V (comment) |
| 3.2 | Agent briefing | not started; stub confirmed | stub `main/agents/session-workspace-brief.ts:47-56`, default deps `:63-66`; render `session-workspace-brief-render.ts:115-119`; SDK prompt `main/agents/agent-run-prompt.ts:15-23` (30-line file) | Claim "SDK runs do not read CLAUDE.local.md" is unverified: `agent-runner.ts:433` sets `settingSources: ['user','project']`. Check before adding a second copy of the brief. | needs 2.1 for the graph section | V anchors, U claim |
| 3.3 | Design-system section | blocked | `dobius/design/` is empty; submodule not initialised | `packages/core` path unverified | needs `git submodule update --init` (network) | V |
| 3.4 | Stale-graph rule | folded into 3.2 / 4.1 | n/a | Row should be removed or marked folded | none | V |

### Phase 4

| Plan ID | Plan says | Code says | Real anchor | Problems | Lag | Conf. |
|---|---|---|---|---|---|---|
| 4.1 | Refresh graph after commit/run | not started | `main/agents/agent-run-end-callbacks.ts:57-63` (`onSettled`). Git hooks live in `dobius/.husky` (there is no `.husky` at repo root) | TASK-08 prefers a git hook over app code: pick one | needs 2.1; Carson's OK to change hooks | V |
| 4.2 | Lesson write-back | not started | finalisation `main/agents/agent-runner.ts:289-296` and `:562-573`; memory path `agent-identity-files.ts:108`; Haiku constant `agent-heartbeat-service.ts:18` | TASK-12's reason ("SDK runs skip user hooks, `agent-runner.ts:433`") looks wrong: that line loads `'user'` settings for non-channel runs. Unverified either way. Depends on 2.3. | chain: 2.3 first | V anchors |
| 4.3 | Grader agent | not started | pattern file exists: `main/agents/asana-triage-verdict.ts` | Duplicate of 8.3 | M | V |
| 4.4 | Vault note per finished card | not started | no Obsidian/vault writer exists anywhere in `main/` | Duplicate of 8.4; should share the one writer from 8.10 | none | V |
| 4.5 | Fix Agent Activity notes | superseded by research | writer was in ADAM, not this repo (`plans/research/AGENT-ACTIVITY-FEED.md`) | Replace with 8.10 tasks A1-A4 | ADAM service state | V (research read) |
| 4.6 | Count non-Bash failures | not started | `~/.claude/hooks/learn-log-failure.sh`; `~/.claude/settings.json` matcher is `"Bash"` | Outside the repo; edits Carson's global config | Carson's OK | V |

### Phase 5

| Plan ID | Plan says | Code says | Real anchor | Problems | Lag | Conf. |
|---|---|---|---|---|---|---|
| 5.1 | Hotkey + pick overlay | not started | `shared/keybindings.ts` (board entry at `:293`); no `components/bug-report/` | Should open the existing `BoardReportDialog`, not a new dialog | M | V |
| 5.2 | Capture context | partly | whole-window capture exists (`BoardReportDialog.tsx:152-165`, `window.api.vertexTasks.captureWindow`); fiber walk `main/browser/grab-guest-script.ts:603-622`; `main/observability/redactor.ts:169` (`redactString`); no console-error ring buffer | none | M | V |
| 5.3 | Spawn fix worktree | not started | `main/runtime/dobius-runtime.ts:12921` (plan says 12821); shape `main/ipc/register-core-handlers.ts:139-157`; origin type `main/agents/execution-gate.ts:5` | New IPC must use the sender gate pattern from `pty.ts:3542`. Same `execution-gate.ts:5` line as 6.4. | M, main-process risk | V |
| 5.4 | Stable component names | not started | `dobius/electron.vite.config.ts` (no `keepNames` today) | Affects bundle size for the whole app; verify in a packaged build | needs a build | V |
| 5.5 | Agent verifies, toast | not started | n/a | none | S | I |
| 5.6 | After-fix screenshot | not started | n/a | Duplicate of 8.6 | L | I |

### Phase 6

| Plan ID | Plan says | Code says | Real anchor | Problems | Lag | Conf. |
|---|---|---|---|---|---|---|
| 6.1 | New `main/telegram-bridge/` | not started | template `main/imessage-bridge/` (config, service, send, guard). Token pattern: `main/telegram-account/vault.ts:32-48` | A large Telegram module already exists (`main/telegram-account/`: `incoming-message.ts`, `terminal-access.ts`, `adam-reply-gateway.ts`, `reply-limits.ts`, plus `cli/handlers/telegram.ts`). A bot bridge would be the third Telegram path. Decide reuse vs new first. | bot token from Carson | V |
| 6.2 | Generalise agent channel service | not started | iMessage hard-coded at `main/agents/agent-channel-service.ts:37,64,78,144,170` | none | S-M | V |
| 6.3 | Per-agent Telegram toggle | not started | `shared/agents.ts:48-50`, `components/agents/AgentEditForm.tsx:304`, `AgentDetailHeader.tsx:96` (all correct) | Persisted agent records need a default for the new field (`agent-record-normalization.ts`) | S | V |
| 6.4 | Gate origin `'telegram-command'` | not started | `main/agents/execution-gate.ts:5`; guard is at `main/imessage-bridge/terminal-send-guard.ts` (plan gives no folder; it is not in `agents/`) | Same line as 5.3 | S | V |
| 6.5 | Settings UI | not started | `components/settings/ImessageBridgeSetting.tsx` is mounted in `settings/MobileSettingsPane.tsx:111`, **not** `AgentsPane.tsx` | Wrong mount point in plan | M | V |
| 6.6 | Later: approve from phone | not started | `main/voice-conductor/imessage-bridge.ts` exists; lines 112-140 not checked | Duplicate of 8.7 | M | U |

### Phase 7

| Plan ID | Plan says | Code says | Real anchor | Problems | Lag | Conf. |
|---|---|---|---|---|---|---|
| 7.1 | Knowledge page | partly | backend `main/ipc/knowledge.ts:71-72`; preload `preload/index.ts:2362-2369` (plan says 2284-2290); page switch `AppWorkspaceShell.tsx:304-314` (plan says 296-306); store action `store/slices/ui.ts:1541-1546` has no caller; board already shows knowledge in `board-studios/ProjectKnowledgePanel.tsx` + `MemoryStudio.tsx:15` | Cheapest path: add the graph to the existing Memory studio | needs 2.1 | V |
| 7.2 | Turn on Laya | not started; "nothing calls it" confirmed | `main/decisions/laya-advisory-composition.ts:40` (`createLayaAdvisoryComposition`) has no caller outside `decisions/` | Duplicate of 8.8 | Laya model host (external) | V |
| 7.3 | Live per-tab checklist | not started | `main/agent-hooks/server.ts`; no to-do fields in `shared/agent-status-types.ts` | Duplicate of 8.9 | L | V |
| 7.4 | Run adoption gate | not started | `shared/agents.ts:112-119` (`AgentRunContext`); `main/agents/execution-gate.ts` | Duplicate of 8.11 | L | V |
| 7.5 | Cloud job buttons | not started | RPC ready: `main/runtime/rpc/methods/cloud-jobs.ts:78,86,94`; `components/kanban/KanbanJobLanes.tsx` has no submit/cancel/retry | Duplicate of 8.12 | needs a cloud job host to test | V |
| 7.6 | Hook install status in Settings | not started | `main/ipc/agent-hooks.ts:136`; renderer only references it in `web/web-preload-api.ts:2436` | Duplicate of 8.13 | S | V / I |
| 7.7 | Usage detail table | plan likely wrong | `stats/UsageSessionsTable.tsx` has 0 importers, but per-provider tables already exist and are the live ones: `ClaudeUsageRecentSessionsTable.tsx`, `CodexUsageRecentSessionsTable.tsx`, `OpenCodeUsageRecentSessionsTable.tsx`, daily charts | "Wire it" would duplicate live UI. Duplicate of 8.14 | Carson's decision: delete instead | V |
| 7.8 | Voice client | not started | `main/runtime/rpc/methods/voice-conductor.ts:22,30`; server side `main/voice-conductor/service.ts` | Depends on 0.5; duplicate of 8.15 | chain | V |

### "Later" (old 8.1-8.4) and Phase 8

| Plan ID | Plan says | Code says | Real anchor | Problems | Lag | Conf. |
|---|---|---|---|---|---|---|
| Later 8.1-8.4 | Replay, skill cleanup, Gmail, Command Center | not started | n/a | **ID clash** with Phase 8. Same items as 8.16, 8.17, 8.18, 8.19. Delete this table. | n/a | V |
| 8.1 | Event log | = 2.2 | see 2.2 | merge rows | L | V |
| 8.2 | Loading screen | = 3.1 | see 3.1 | merge rows | artifact | V |
| 8.3 | Grader agent | = 4.3 | see 4.3 | merge rows | M | V |
| 8.4 | Vault note per card | = 4.4 | see 4.4 | merge rows; share writer with 8.10 | none | V |
| 8.5 | Non-Bash failures | = 4.6 | see 4.6 | merge rows | Carson's OK | V |
| 8.6 | After-fix screenshot | = 5.6 | see 5.6 | merge rows | L | I |
| 8.7 | Telegram approve / commands | = 6.6 | see 6.6 | merge rows | after 6.1-6.5 | I |
| 8.8 | Turn on Laya | = 7.2 | see 7.2 | merge rows | external host | V |
| 8.9 | Live checklist | = 7.3 | see 7.3 | merge rows | L | V |
| 8.10 | Agent activity feed | not started; research done | journal `main/agents/agent-run-event-journal.ts:87-108`; an Activity page already exists: `components/activity/ActivityPrototypePage.tsx`, shown at `AppWorkspaceShell.tsx:312` | Research proposes a new panel without mentioning the existing Activity page. Replaces 4.5. | ADAM decision (A7) | V |
| 8.11 | Run adoption gate | = 7.4 | see 7.4 | merge rows | L | V |
| 8.12 | Cloud job buttons | = 7.5 | see 7.5 | merge rows | cloud host | V |
| 8.13 | Hook status | = 7.6 | see 7.6 | merge rows | S | V |
| 8.14 | Usage table | = 7.7 | see 7.7 | merge rows | decision | V |
| 8.15 | ADAM voice client + voice branch | not started | branch `feat/adam-voice-control` (local + fork); 33 commits / 44 files not counted this session | Superset of 7.8 and 0.5 | L, needs research | V branch, U counts |
| 8.16 | Replay tests | not started | n/a | none | L | I |
| 8.17 | Weekly skill cleanup | not started; research done | `plans/research/SKILL-CLEANUP.md`; scheduler API in `main/automations/` not read | Mostly outside the repo (`~/.claude`) | Carson's OK for deletes | V (research read) |
| 8.18 | Gmail intake | not started; research done | card store `main/vertex/vertex-task-store.ts:202`; `'gmail'` origin already typed (`shared/vertex-task-types.ts:233`, per research) | DECISIONS line 117 says KILL, Phase 8 says add: Phase 8 wins per round 4b, but TASK-2-gmail-read-source.md references a file that does not exist | Gmail OAuth (Google sign-in) setup, external | I (research not re-verified line by line) |
| 8.19 | Command Center real tasks | unverified | `components/command-center/` holds a data catalog (`DataCatalogPanel.tsx`); "browser-only storage" claim not confirmed | unclear target | L | U |
| 8.20 | Delete with OK | see Phase 0 note | see Phase 0 note | two named files have importers | Carson's OK | V |

### Phase 9

| Plan ID | Plan says | Code says | Real anchor | Problems | Lag | Conf. |
|---|---|---|---|---|---|---|
| 9.1 | New `dobius board list` | **plan wrong: partly exists** as `dobius board consoles` | `cli/specs/board.ts:34-40`, `cli/handlers/board.ts`, `main/runtime/rpc/methods/board-consoles.ts:86-116,200-207` | Extend the existing summary with live handle, running flag, agent; do not add a second command | S (was M) | V |
| 9.2 | `board send --card` | not started | add beside `board.listConsoles`; send-time lookup to copy: `board/cards/use-orchestrator-thread.ts:72-110` (plan anchor correct) | Must refuse an unknown card (ORCHESTRATOR-NOTES #12: silent fallback to the active terminal) | M, PTY write path | V |
| 9.3 | Card identity env vars | not started | `DOBIUS_TAB_ID` is set in the renderer: `terminal-pane/pty-connection.ts:2564`, `lib/launch-agent-background-session.ts:144`, `lib/launch-worktree-background-terminals.ts:57` | Three injection points, not one. Title changes after spawn will make the env value stale. | S | V |
| 9.4 | `tab:<tabId>` handles | resolver not located | unverified | none | S | U |
| 9.5 | Honest dead consoles + Restart | partly | Restart per row exists: `board/cards/OrchestratorCard.tsx:108,142` -> `board/console-card/console-actions.ts:92-99`. No "not running" badge found on console cards. | none | live-app check | V / I |
| 9.6 | CLI into a board orchestrator | not started | n/a | Depends on 9.2 | M | I |
| 9.7 | Stable tabId across restart | not started | `console-actions.ts:92` (`restartConsole`) | Touches the same tab/terminal store as the wipe bug and -1.4 | wait for the wipe-bug fix | I |

### Cross-cutting

| Item | Finding | Conf. |
|---|---|---|
| Known blocker | "Switching workspace wipes the board's agent terminals" (ORCHESTRATOR-NOTES #11). Owned by another agent. Not investigated here. It blocks -1.3, -1.6, 9.5, 9.7 live checks. | n/a |
| Plan header | "Status: plan only, nothing built yet" is false: -1.1, -1.2, -1.12, 0.1, 0.2, 0.3 (part), 0.4 are committed. | V |
| Plan base line | Plan says based on `ac40017a`; that commit is in the branch history. | V |

## Plan corrections (exact edits)

1. **Line 3**: change "Status: plan only, nothing built yet" to "Status: in progress. Done: -1.1, -1.2, -1.12, 0.1, 0.2, 0.4; partly: 0.3."
2. **Phase 9 findings**: delete "No `dobius board` command exists; the CLI cannot list cards". Replace with: "`dobius board consoles` lists console cards (id, tabId, title, role) but not the live handle or whether the terminal is running." Re-word 9.1 to "extend `board consoles` / `board.listConsoles` (`main/runtime/rpc/methods/board-consoles.ts:86-116`) with handle, running, agent" and size it S.
3. **-1.13**: replace the reason with "tests pass `null` as the IPC event; `pty.ts:2769` (since 2026-10-27, `f5e57ecd`) and `pty.ts:3830-3987` (since `9ea3c633`) read `event.sender`. Fix: use `mainWindowIpcEvent` (`pty.test.ts:256`) in the ~130 call sites." Size S.
4. **1.1**: mark "EXISTS: `BoardFoundBugButton` + `BoardReportDialog`. Only 'send via teammate' remains, after 1.4." **1.5** and **1.6**: mark "mostly exists, compare against the Line A PR before building" with the anchors in the table. **1.7** and **1.8**: delete (plan already skips / folds them). Delete the sentence "Order: 1.8 first ... then 1.1".
5. **Add real remaining ports as their own rows**: snooze tabs, My Day / Today pick, What's-new-after-update.
6. **Delete the "Later" table** (old 8.1-8.4): it reuses Phase 8 IDs.
7. **Merge duplicate rows**: 2.2=8.1, 3.1=8.2, 4.3=8.3, 4.4=8.4, 4.6=8.5, 5.6=8.6, 6.6=8.7, 7.2=8.8, 7.3=8.9, 4.5->8.10, 7.4=8.11, 7.5=8.12, 7.6=8.13, 7.7=8.14, 7.8->8.15. Keep one ID each.
8. **Path fixes**: 5.3 `dobius-runtime.ts:12821` -> `:12921`; 7.1 `preload/index.ts:2284-2290` -> `:2362-2369` and `AppWorkspaceShell.tsx:296-306` -> `:304-314`; 0.4 `install-clis.ts:140-167` -> `:149-185`; 6.4 `terminal-send-guard.ts` -> `main/imessage-bridge/terminal-send-guard.ts`; 6.5 "mount in `AgentsPane.tsx`" -> "iMessage setting is mounted in `settings/MobileSettingsPane.tsx:111`"; 6.1 token store -> `main/telegram-account/vault.ts:32-48`; 4.1 husky lives at `dobius/.husky`.
9. **3.3**: add prerequisite "initialise the `dobius/design` submodule in this checkout (folder is empty)".
10. **0.5 / TASK-04**: change "Sam's branches (origin)" to "origin AND fork; `feat/adam-voice-control` is on fork".
11. **7.1**: add "the board Memory studio already reads the knowledge backend (`ProjectKnowledgePanel.tsx`); `openKnowledgePage` exists with no caller and no page branch".
12. **7.7 / 8.14**: change "keep, wire it" to "decide: delete `UsageSessionsTable.tsx` (0 importers) because per-provider session tables already ship".
13. **8.10**: add "an Activity page already exists (`components/activity/ActivityPrototypePage.tsx`); decide whether the feed lives there".
14. **Phase 6 intro**: add a decision row "reuse `main/telegram-account/` or build a separate bot bridge".
15. **Delete-candidate list**: remove `CreatePullRequestDialog` and `FeatureTourPreview` until each path is re-checked (both names have importers).
16. **New missing items found**: (a) `dobius terminal send` with an empty `--terminal` must fail (ORCHESTRATOR-NOTES #12), not in any phase; (b) lost `ask` replies on reconnect (#13); (c) root `pnpm test:dobius` script (#9); (d) check whether SDK runs really skip user hooks / CLAUDE.local.md (`agent-runner.ts:433`) before 3.2 and 4.2.

## Recommended build order (next 10)

Waves run in parallel inside a wave; files do not overlap inside a wave.

**Wave 1 (now, no decisions needed)**
1. **-1.13 fix pty tests** (`main/ipc/pty.test.ts` only). Why: turns the main-process test file green so later PTY work can be trusted. Size S. Role: Test.
2. **0.7 stale config entries** (`dobius/config/*.json`; leave the e2eBridge mesh mock alone unless proven unused). Why: stops lint noise for every agent. Size S. Role: Build.
3. **-1.4 merge hibernation fix** (renderer `lib/agent-hibernation-planner.ts`, `store/slices/terminals.ts`). Why: clean merge, already written. Tell the wipe-bug owner first, same store. Size S. Role: Build.
4. **Plan corrections 1-15** (plans folder only). Why: stops agents building things that exist. Size S. Role: Docs.

**Wave 2 (after wave 1)**
5. **9.1 extend `board consoles`** (`main/runtime/rpc/methods/board-consoles.ts`, `cli/specs/board.ts`, `cli/handlers/board.ts`). Why: biggest orchestration time saver. Size S. Role: Build.
6. **-1.15 + -1.14** (`main/cloud-backup/controller.ts`; `board/board-route/board-reset.ts`). Why: small tidy and finishing Reset before install. Size S. Role: Build.
7. **0.5 voice research incl. fork branch** (read-only). Why: unblocks 7.8 / 8.15 scoping. Size S. Role: Plan.

**Wave 3**
8. **9.2 + 9.3 send by card name, card identity env** (`board-consoles.ts`, `terminal-pane/pty-connection.ts`, two launch files). Why: completes "find and talk to a card". Size M. Role: Build. Needs 5 done.
9. **2.3 postcheck + retry** (`main/agents/agent-runner.ts`, `automations/run-lifecycle.ts`, new `shared/automation-postcheck.ts`). Why: foundation for 4.2 and the grader. Size M. Role: Build, with a Plan pass first (main-process).
10. **-1.3 live Restart test, then -1.6 install** (after the wipe bug is fixed and Carson says OK). Why: ships the work already done. Size S. Role: Test.

Next in line after these: 3.2 briefing (needs 2.1 Graphify decision), then Phase 5 on top of the existing report dialog.

## Top risks (ranked)

1. **Workspace-switch wipe bug**: every live check and every multi-agent wave loses sessions until fixed. Known blocker, owned elsewhere.
2. **Building what already exists**: 1.1, 1.5, 1.6, 9.1, 7.7 would duplicate live code if the plan is not corrected first.
3. **`agent-runner.ts` is a shared choke point**: 2.3, 4.1, 4.2, 4.3 all edit it. Parallel agents will collide. Run them in sequence.
4. **Main-process security surface**: new IPC (5.3), new bridges (6.x), and -1.8 (phone RPC listening on every network interface, `runtime-rpc.ts:785`) all need the sender-gate pattern and a review pass.
5. **External services with no owner yet**: Laya model host (7.2/8.8), Gmail OAuth (8.18), Telegram bot token (6.x), cloud job host (7.5), design submodule download (3.3).
6. **Untested "DONE" items**: -1.2 and 0.4 are done in code but never checked in the running app; the 164-failure count and the -1.5 failure were not re-run in this audit.
7. **Three Telegram paths**: outbound notifications, the personal-account bridge (`main/telegram-account/`), and the planned bot bridge. Without a decision this becomes three token stores and three safety models.

## Open questions for Carson

1. Telegram: reuse the existing personal-account module or build the separate bot bridge?
2. Usage table: delete the unused file, or is there a view you still want?
3. Graphify vs the "no third indexer" rule (already Appendix D.6): blocks 2.1, 3.2 graph section, 4.1, 7.1.
4. May an agent download the design-system submodule into this checkout?
5. Activity feed: put it on the existing Activity page, the board, or both?

## What was not verified

- No tests were run: the counts "164" (pty) and the -1.5 failure are taken from the plan.
- Line A pull-request numbers (#6-#38) and Asana items in Appendix A/B were not checked (no network calls made).
- -1.9 stranded commits, 9.4 handle resolver, 8.19 Command Center storage, 6.6 line range, issue-number mapping in -1.1.
- Research-file line references (Gmail, skills, activity) were read but not re-verified line by line, except the paths cited in the table.
