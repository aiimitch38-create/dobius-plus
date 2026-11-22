# Workstation Build Plan

Written 2026-11-21. Owner: Carson. Status: IN PROGRESS. Done: -1.1, -1.2, -1.12, 0.1, 0.2, 0.4, workspace-switch wipe fix (e498f42d); 0.3 partly.

> **Audit 2026-11-21 (Iris, read-only, verified against code): `plans/research/IRIS-PLAN-AUDIT-20261121.md` wins where it disagrees with the rows below.** Key corrections:
> - Phase 9: `dobius board consoles` ALREADY exists (`cli/specs/board.ts`, `main/runtime/rpc/methods/board-consoles.ts:200-207`). 9.1 = extend it with live handle + running flag (S). Per-row Restart exists (`OrchestratorCard.tsx:142`), so 9.5 is partly done.
> - Phase 1: already in this app, do NOT rebuild: 1.1 report a problem (`BoardFoundBugButton.tsx`, `BoardReportDialog.tsx`), 1.5 chat folding + question cards (`native-chat-tool-fold.ts`, `NativeChatQuestionCard.tsx`), 1.6 links in browser / blank-window recovery / restart. Real remaining ports: snooze tabs, My Day, What's new. Phase 5 extends the existing report dialog.
> - -1.13: tests pass `null` as the IPC event (118x to pty:spawn, 12x to newer gated handlers); swap in the existing `mainWindowIpcEvent` (`pty.test.ts:256`). Size S.
> - Phases 2-7 duplicate Phase 8 (2.2=8.1, 3.1=8.2, 4.3=8.3, 4.4=8.4, 4.6=8.5, 5.6=8.6, 6.6=8.7, 7.2=8.8, 7.3=8.9, 4.5->8.10, 7.4=8.11 ... 7.8->8.15). The "Later" table's 8.1-8.4 are different items: ignore that table.
> - 3.3 blocked: `dobius/design/` submodule not downloaded. 6.x: a Telegram module already exists (`main/telegram-account/`), decide reuse first. 7.7/8.14: drop (unused file, live UI already covers it).
> - 2.3, 4.1, 4.2, 4.3 all edit `main/agents/agent-runner.ts`: run in sequence, never in parallel.
> - NEW -1.16 (Codex, pre-existing): hibernation can strand a resumable pane if it is revealed within ~150 ms of the kill; main rejects the resume claim because the sleeping record's debounced save (`session-write-subscriber.ts:163`) has not landed (`pty.ts:1397`), and no retry follows. Fix: wait for main's acknowledgement of the sleeping record before killing. Size S-M.
> - Live voice ADAM: research in `plans/research/REALTIME-VOICE-ADAM.md` (`gpt-live-1.1`, 8 tasks, about $13/day estimate).
> - Next order: Wave 1 = -1.13, 0.7, -1.4 hibernation merge; Wave 2 = 9.1, -1.15 + -1.14, 0.5 voice research (fork branch too); Wave 3 = 9.2 + 9.3, 2.3, -1.3 live Restart test.

## The one rule for this plan

Every build in this plan happens in ONE checkout, and only this one:

- Folder: `~/Projects (Code)/dobius-plus/WORKSTATION-BUILD`
- Branch: `aiimitch38-create/workstation-build`
- Based on: `feat/board-restart-reset` (`ac40017a`) = the installed 2.1.9 line (`fix/orb-hermes-2.1.8-ui`, per INSTALL-PROVENANCE.json) + the A-menu work, plus the design-system submodule commit from `fix/security-critical-20261027`. Rebased 2026-11-21. The security branch's two Adam/voice-orb commits were skipped: newer versions are already on this line (e.g. `12742ea2`).
- App source: `dobius/` (TypeScript). Paths below are relative to `dobius/src/` unless noted.

No other worktree, no other branch, no main checkout. Push only to the `fork` remote. Install only through
`scripts/install-dobius-gated.sh`, and only after Carson's OK.

Note: the main checkout at `~/Projects (Code)/Dobius/dobius-plus` had 44 uncommitted files when this copy was
made. They are NOT in this copy. Carson decides whether they come over.

## The goal

Carson says one sentence and the workstation turns it into real work. Agents start fully briefed, check their
own work, learn from failures, and the knowledge flows back into two memories:

- **Big brain:** the Obsidian vault, `~/Obsidian Vault/AI Research/`, shared across all projects and tools.
- **Nervous system:** one Graphify knowledge graph per project.

The loop that ties it together (from `plans/DOBIUS-AGENTIC-BUILD-PLAN.md:74`):
a thought lands → Laya turns it into a card → ADAM sends the card to a tab → the tab shows the card's checklist,
live → Laya flags "really finished or silently skipped" → the verification floor confirms → Review → Carson signs
off → Done → logged to memory (vault + graph).

## Open decisions (Carson)

| # | Decision | Default if not answered |
|---|---|---|
| D1 | Base app | DECIDED 2026-11-21 by Carson: the TypeScript app is the main app. Sam's JS work gets ported in, one feature at a time, only where this app lacks an equivalent. |
| D2 | Bring the 44 uncommitted files from the main checkout into this copy? | No, leave them |
| D3 | The video link (her 10-minute Claude Code setup), to compare against this plan | Skip the comparison |

## Phase -1: save and finish what is already in flight (from the 2026-11-21 handoff)

Source: `.claude/worktrees/orb-hermes-2.1.8/plans/HANDOFF-20261121-board-restart-reset.md` and
`~/Projects (Code)/dobius-plus/FEATURES-HUB/IRIS-REPORT-20261121.md`.

| ID | Task | State | Size |
|---|---|---|---|
| -1.1 | DONE 2026-11-21 (Test 2, 9ea3c633): Bring the uncommitted security fixes (#6/7/8/27/30/32) from the main checkout into this copy and commit them. These are part of the 44 uncommitted files (D2). Most important save. | uncommitted in `~/Projects (Code)/Dobius/dobius-plus` | M |
| -1.2 | DONE except live check 2026-11-21 (Test 2, a238c856): Finish Reset board: the "stay on the empty board" fix (`board-route/board-reset.ts`) is copied here UNCOMMITTED and UNTESTED. Lint, typecheck, test in an isolated copy (incl. pinned console closing late), commit. | uncommitted here | S |
| -1.3 | Test Restart Dobius+ live: tabs must come back | not tested | S |
| -1.4 | Merge the hibernation fix `a0b689fc` (branch `fix/hibernation-unresumable`) | not merged | S |
| -1.5 | Pre-existing failing test `board-home/BoardHome.test.tsx` "closing the studio returns to Home" | failing before any change | S |
| -1.6 | Install the A-menu + Reset work into /Applications via the gated script, after Carson's OK | not installed, not pushed | S |
| -1.7 | A menu "other things": candidates Usage (panel exists) and Report a problem (`BoardReportDialog` exists). Carson picks. | open question | S |
| -1.8 | Remaining security items in the installed code: computer-use risky-click bypass via x/y clicks + cache fails open (#4/#5, `action-decision.ts:91-100`), phone RPC on 0.0.0.0 (#9, `runtime-rpc.ts:785`), pair screen never names the computer (#10), then #11-26, #28-29, #31, #33-35 | open | L |
| -1.9 | Stranded Line B commits not on this line: 2026-10-09 "full-system" batch, mobile-terminal-repairs (7), hostinger (4), ADAM B2/B3/B5 (4-6 each). Check each with `git cherry`, port what still matters. | not merged | M |
| -1.10 | Round2 worktree: uncommitted removal of the broken "Panels" rail button | uncommitted | S |
| -1.11 | `$10` agent spend caps (up from $0.50/$2), uncommitted in `dev-environment-tab`. Carson decides keep or drop. | decision | S |
| -1.12 | `BUILD-LOG.md` entry for 2.1.9 | DONE 2026-11-21 (Docs 1, 1684063d) | S |
| -1.13 | 164 pre-existing failures in `dobius/src/main/ipc/pty.test.ts`: tests pass `null` as the IPC event, which the sender gate rejects (fail on the clean base too; verified by Claude 5: 164 failed on both 16b2e5e1 and a238c856) | open | S-M |
| -1.14 | Reset can land on an editor or browser tab instead of the board (fallback path in `closeTerminalTab`), and the pinned-console late-close case is untested | open | S |
| -1.15 | Tidy: bare `{ }` block left in `main/cloud-backup/controller.ts` after the status-read refactor | open | S |

Sam port order suggested in the handoff (feeds Phase 1): restart restores tabs, links open in browser, chat folding
and question cards, report a problem, snooze tabs, what's new.

## Phase 0: cleanup and quick wins (approved by Carson 2026-11-21)

| ID | Task | Where | Size |
|---|---|---|---|
| 0.1 | DONE (Build 2, 390773a6) Remove the Mesh Compute settings card and its code | `renderer/src/components/communications/features/mesh-compute/`, mount at `features/settings/ui/SettingsPanels.tsx:827`, `shared/api/tauriMesh.ts` | S |
| 0.2 | DONE (Build 2, 390773a6) Remove the Hosted Communities settings card and its code | `features/settings/ui/HostedCommunitiesSettingsCard.tsx`, mount at `SettingsPanels.tsx:833`, `HostedCommunityOnboarding.tsx` | S |
| 0.3 | PARTLY DONE (Build 2, ef66d69c: 10 files; files imported only by other dead files were kept) Delete the ~42 unreachable Channels files. Re-check each has no importer before deleting. | `renderer/src/components/communications/features/**` | M |
| 0.4 | DONE in code, not yet smoke-tested in the installed app (Build 2, 19d170a9) Install ADAM's 4 missing command wrappers: `/tabSendTo`, `/tabFocus`, `/tabRead`, `/tabOpen` | `main/dobius-cli/install-clis.ts:140-167`, routes at `main/dobius-cli/dispatch-server.ts:298-310` | S |
| 0.6 | Finish 0.3: delete whole dead chains (files reachable only from other dead files) using an entry-point reachability pass, not single-file grep. List in plans/algorithm/TASK-02-deleted.md "Kept candidates" | `renderer/src/components/communications/features/**` | M |
| 0.7 | Remove stale entries for deleted files from `config/localization-coverage-allowlist.json` and `config/lint-baseline.json`, and the mesh mock in `communications/testing/e2eBridge.ts` | config | S |
| 0.5 | Research: find any hands-free / voice-driven Dobius work on Sam's branches (origin) and report what it is, where, and whether it can be ported | read-only | S |

Also safe-to-delete candidates, needing Carson's OK per item: the fake Operations dashboard
(`renderer/src/components/operations/`), legacy UI orphans (CreatePullRequestDialog, LinearAgentSkillSetupPrompt,
RepoStep, FeatureTourPreview, StarNagToastHost, and others), the unused comms identity IPC
(`main/ipc/communications-identity.ts`), and test-only chat projections (`main/communications/chat/*-projection.ts`).

## Phase 1: one app (bring Sam's and Carson's work together)

Sam's JavaScript app and this TypeScript app have diverged, so Sam's work is PORTED (rebuilt here), not merged.

How far behind (from the handoff, 2026-11-21): the apps split 2026-06-24 (`f06c1763`). Line A has changed ~112k lines
in 495 files since, with 99 releases (48 since Nov 1). Ports ship here as 2.1.10, 2.1.11, ... (stay on 2.1.x).

Full Line A feature list this app lacks (keyword-checked, not click-tested):
- Team: cross-Tailscale linking (#37), Windows `dobius-team` (#38), Report a problem from status bar / via teammate (#18, #30), team inbox with mark-done
- Phone: drive a tab's Claude with questions + permissions (#12), iPhone share sheet (#33), QR pairing, voice lock + confirm before send, notification taps open their tab (#31), "Add a computer" (#36)
- Daily use: My Day / Today pick, snooze tabs + window-wide Terminal/Chat, chat folding + Arctic Blue own-message box (#24), question cards (#26, #34), links open in browser (#28), sidebar tab-order + double-click fix (#19)
- Reliability: Restart without updating + every tab back (#7, #13), What's new (#8), auto-move on limit (opt-in), cheaper liveness checks (#6), blank window self-recovers (#27)
- Skip: #20, #22, #23, #35 (Line A release tooling), Windows notes

Port order (handoff): A menu (in progress) -> restart restores every tab -> links open in browser -> chat folding + question
cards -> report a problem (merge with Phase 5) -> snooze tabs -> what's new -> phone features last (this app has its own phone app).

Recipe per port:
1. Read the Line A PR (`gh pr view N -R statusdigitalmarketing/dobius-plus`): that is the spec.
2. Pick its board home: top bar (A menu, usage pill), left rail / side apps, console card, or Settings.
3. Build from existing board parts (`BoardRailButton`, `board-surface-classes`, `useConfirmationDialog`, board menus).
4. Verify in the isolated test copy with a screenshot (recipe in the appendix).
5. Install via the gated script. After the first few, run 3-5 ports in parallel (still inside this one copy's branch flow).

The table below is superseded by this list where they differ.

| ID | Task | Source | Size |
|---|---|---|---|
| 1.1 | Port "Report a problem" (status bar, plus send through a linked teammate) | origin/main #18, #21, 2026-11-18 commits | M |
| 1.2 | Port Phone mode: drive a tab's Claude from the phone, with question and permission cards | origin/main #12, phone question-card commits | L |
| 1.3 | Port the iPhone share sheet | origin/main 2026-11-19 | M |
| 1.4 | Port Team linking over Tailscale, plus Windows support | origin/feat/team-cross-tailnet, feat/team-cli-windows | L |
| 1.5 | Port Chat improvements: fold older turns, answer question cards in Chat | origin/main #24, #26 | M |
| 1.6 | Port fixes: auto-resume, links open in the browser, blank window recovery | origin/main #13, #27, #28 | M |
| 1.7 | Port release safety checks (refuse a broken package or mismatched dependencies) | origin/main #20, #22, #23 | S |
| 1.8 | Port Carson's Agent Pre-Flight Primer (task 10) | branch `aiimitch38-create/agent-preflight-primer`, `electron/agent-preflight.js` | M |

Order: 1.8 first (the loading screen depends on it), then 1.1 (the bug button builds on it), then the rest.
Before each port, list the feature's commits on origin and check whether this app already has an equivalent.

## Phase 2: foundation

| ID | Task | Where | Size |
|---|---|---|---|
| 2.1 | Run Graphify once on each project so every project has a graph | `/Users/bayou/.local/bin/graphify`, output in each repo's `graphify-out/` | S per repo |
| 2.2 | One event log and proof-of-done: a task can only reach Done with evidence attached | plan B3/B6; `shared/vertex-task-types.ts`, `main/ipc/vertex-tasks.ts` | L |
| 2.3 | "Check after finishing, then retry" loop: run the real test/build when an agent finishes; on failure hand the output back, up to 3 rounds, then mark Blocked | add `postcheck` beside `shared/automation-precheck.ts`; reuse `main/automations/precheck-runner.ts`; hook `main/automations/run-lifecycle.ts:70`, `main/agents/agent-runner.ts:183-201`, `main/runtime/orchestration/coordinator.ts` | M |

## Phase 3: the loading screen and briefing

| ID | Task | Where | Size |
|---|---|---|---|
| 3.1 | Build the real loading screen from Carson's demo (https://claude.ai/artifact/8NFeVYgPNSC63QodeMhvvj), shown while the briefing loads | renderer, terminal pane | M |
| 3.2 | The briefing every agent gets before its first message: branch and changes, lessons learned, project graph (GRAPH_REPORT + `graphify query`), design system, matching Obsidian notes, MCP connectors, other tabs in the project, spend | replace the stub at `main/agents/session-workspace-brief.ts:46-64`; render at `session-workspace-brief-render.ts:115`; add to `main/agents/agent-run-prompt.ts` (SDK runs do not read CLAUDE.local.md) | M |
| 3.3 | Design system section: tokens and component list from `dobius/design` (packages/core) | `dobius/design` submodule | S-M |
| 3.4 | Rule: if the graph is missing or older than the last commit, refresh it first, or mark the briefing stale | same as 3.2 | S |

## Phase 4: self-improving loops

| ID | Task | Where | Size |
|---|---|---|---|
| 4.1 | Refresh the graph after every commit / finished run (`graphify update`, no AI cost) | `main/agents/agent-run-end-callbacks.ts` (`onSettled`) or a post-commit hook | S |
| 4.2 | Lesson write-back: after a failed or retried run, one short lesson goes into that agent's memory, deduped and capped | `main/agents/agent-runner.ts:293,568`, `main/agents/agent-identity-files.ts`, Haiku pattern from `main/agents/agent-heartbeat-service.ts:18` | S-M |
| 4.3 | Separate grader agent for important tasks: fresh context, read-only, returns pass or named gaps, max 2 revise rounds | `startAgentRun` with json_schema output (pattern: `main/agents/asana-triage-verdict.ts`) | M |
| 4.4 | Finished card writes one note to the vault `Inbox/` (never rewrites existing notes) | vault writer | S |
| 4.5 | Fix the Obsidian "Dobius Agent Activity" notes (stopped 2026-10-23; writer not found) | find the writer first | S-M |
| 4.6 | Count every failure, not just Bash failures, in the global learning hook | `~/.claude/hooks/learn-log-failure.sh` | S |

## Phase 5: bug-to-fix button

Press a hotkey, click the broken button, and a terminal opens on its own copy of the code with an agent already
fixing it. Builds on 1.1 (Report a problem).

| ID | Task | Where | Size |
|---|---|---|---|
| 5.1 | Keybinding + pick mode overlay (hover highlight, click, Esc to cancel, optional note) | `shared/keybindings.ts`, new `renderer/src/components/bug-report/ElementPickOverlay.tsx` | M |
| 5.2 | Capture: component chain, DOM path, view, recent console errors (new ring buffer), cropped screenshot, redacted log tail | new `renderer/src/lib/bug-report-element-context.ts`, `renderer-console-error-buffer.ts`; screenshot via `webContents.capturePage` (template: `main/browser/browser-grab-screenshot.ts`); redact with `main/observability/redactor.ts:169` | M |
| 5.3 | Spawn: new IPC `bugReport:dispatch` → pause-crew gate → find the Dobius repo → one-at-a-time cap → `runtime.createManagedWorktree(...)` with the fix prompt | new `main/ipc/bug-report.ts`; `main/runtime/dobius-runtime.ts:12821`; copy shape from `main/ipc/register-core-handlers.ts:138-157`; new origin `'bug-report'` in `main/agents/execution-gate.ts:5` | M |
| 5.4 | Stable component names in the installed app (React 19 dropped source info) | `electron.vite.config.ts` | M |
| 5.5 | Agent verifies (typecheck, tests, build), never installs, never pushes; a toast links to the fix for Carson's review | prompt + toast | S |
| 5.6 | Later: automatic after-fix screenshot in an isolated test copy | learned-dobius-isolated-test-copy skill | L |

## Phase 6: Telegram

A "Connect Telegram bot" setting. Carson messages an agent and gets a reply. Copies the iMessage bridge. This is
separate from the existing outbound Telegram notifications and the personal-account group bridge.

| ID | Task | Where | Size |
|---|---|---|---|
| 6.1 | New `main/telegram-bridge/`: config, encrypted token store, bot client (long-poll + send), bridge service | copy `main/imessage-bridge/*`; token store from `main/ipc/telegram-account-credentials.ts` | M |
| 6.2 | Make the agent channel service work for any channel, not just iMessage | `main/agents/agent-channel-service.ts` | S-M |
| 6.3 | Per-agent "reachable on Telegram" toggle | `shared/agents.ts:48`, `AgentEditForm.tsx:304`, `AgentDetailHeader.tsx:96` | S |
| 6.4 | Pause-crew gate origin `'telegram-command'` | `main/agents/execution-gate.ts:5`, `terminal-send-guard.ts` | S |
| 6.5 | Settings UI: paste token (never shown again), send /start to pair, enable, test | copy `ImessageBridgeSetting.tsx`; mount in `AgentsPane.tsx` | M |
| 6.6 | Later: status push and approve-from-phone with reply codes; /tabs, /read, /send | `main/voice-conductor/imessage-bridge.ts:112-140` pattern | M |

Safety: only Carson's numeric Telegram user id, private chat only, pairing step required, skip the message
backlog on enable, read-only tools + budget cap for agent replies, never auto-answer a permission prompt, scrub
terminal output before sending. Use a NEW bot token in safeStorage, not the notification bot's token.

## Phase 7: missing connections

| ID | Task | Where | Size |
|---|---|---|---|
| 7.1 | Knowledge page: backend exists, build the page and show each project's graph there | `main/ipc/knowledge.ts:72-75`, `preload/index.ts:2284-2290`, add a branch in `renderer/src/components/app-shell/AppWorkspaceShell.tsx:296-306` | M |
| 7.2 | Turn on Laya (built, nothing calls it) | `main/decisions/laya-*.ts`, compose from `main/index.ts` | L |
| 7.3 | Live per-tab checklist from the agent's to-do list | `main/agent-hooks/`, new side panel | L |
| 7.4 | Run adoption gate: every managed run is tied to a task | `shared/agents.ts:115-118`, `main/agents/execution-gate.ts` | L |
| 7.5 | Cloud job buttons: submit / cancel / retry | `main/runtime/rpc/methods/cloud-jobs.ts:78-120`, `KanbanJobLanes.tsx` | M |
| 7.6 | Show agent hook install status in Settings | `main/ipc/agent-hooks.ts:136+` | S |
| 7.7 | Usage detail table (daily, breakdown, recent sessions) | `renderer/src/components/stats/UsageSessionsTable.tsx` | S |
| 7.8 | Voice client for `voice.intent` / `voice.reply` (depends on 0.5) | `main/runtime/rpc/methods/voice-conductor.ts:22,30` | M |

## Later

| ID | Task | Size |
|---|---|---|
| 8.1 | Replay real past tasks whenever an agent's instructions, skills or model change; block a change that gets worse | L |
| 8.2 | Weekly skill cleanup: suggest skills from repeated work, merge duplicates (e.g. 10 copies of subagent-prompt-engineer). Suggestions only. | M |
| 8.3 | Gmail intake and Obsidian indexer (plan D7) | L |
| 8.4 | Command Center records backed by real tasks instead of browser-only storage | L |

## How every task runs (Done Bar)

PLAN (`plans/TASK-N.N.md`) → IMPLEMENT → VERIFY (typecheck per the learned-dobius-typecheck-configs skill, tests,
`pnpm --dir dobius run build` exit 0) → REVIEW (re-read diff, code-reviewer subagent) → COMMIT (specific files) →
screenshot in an isolated test copy for UI work → LOG (`BUILD-LOG.md`). No push, PR, install or Asana closing
without Carson's OK.

## Appendix A: Line A housekeeping (the team's app, origin/main)

Carson's app is Line B, but the team still ships Line A daily. These are not Line B build tasks.

- `fix/bughunt-20261027` (also in `aiimitch38-create/UI-UPDATES`): 7 real fixes not on origin/main (project-path gates on checkpoint / filewatcher / voice-bridge `/stage`; Costs crash on undefined projectName `Costs.jsx:77`; Tasks/Kanban stage mismatch; stale Search results; git-service path trap; tear-off dock closing a sibling tab; dead Kanban fallback). Cherry-pick onto a fresh branch from origin/main.
- `fix/cost-tracker-accuracy`: Costs tab overstates spend ~2.9x; `electron/data-service.js:2878-2886` still has old Opus 15/75 pricing and a Sonnet fallback. Re-check prices before shipping. Also check whether Line B's cost view has the same bug.
- PRs on origin: #32 docs only, Codex-clean, needs a merge click (Sam's account); #25 Windows accounts, draft with open P1s; #5 Office view, shelved; #4 V2-for-review, stale, close candidate (Carson's call).
- Fork PRs #1-#5 (stabilization, ADAM B2/B3/B5, Board): all open, unmerged. Close or fold into this copy (Carson's call).
- GWS Features 2/3 (in-app Google view, voice send-mail); Mac PATH order lets Homebrew `gws` beat the shim.
- `features` worktree is contaminated (a Line B package.json in a Line A checkout). Salvage its +85 lines of lessons; never commit that package.json.
- `FEATURES-HUB/Roamies/` is a third-party AGPL-3.0 clone: reference only, never commit or copy code from it.
- 165 local branches: 120 fully absorbed by one line, 45 have commits in neither (`git cherry` against both tips). Cleanup only with Carson's OK per branch.

## Appendix B: Asana (Dobius+ project 1214686777705698)

14 open, all past due, none Carson's. Review lane only for Sam; never auto-close anything.
- Sam (7): message disappears bug, chat feature, infinite working clock, Restart brings every tab back, reorder sidebar, History tab, chat not working properly
- Brett (4): pop-up for links, sidebar double click, phone voice lock + confirm, Voice Orchestrator
- Bryan (3): fix chat, fix, auto-collapse old tool calls + Better Health Now theme
- Already shipped on Line A: links pop-up (#28), sidebar double click (#19), phone voice lock, chat folding (#24). Several map straight onto the Phase 1 port list.

## Appendix C: test-copy recipe that works (from the handoff)

1. Build: `VITE_EXPOSE_STORE=true npx electron-vite build --mode e2e` in `dobius/`.
2. Launch via a wrapper with `HOME=/private/tmp/<x>h`, `DOBIUS_E2E_USER_DATA_DIR=/private/tmp/<x>`, `NODE_ENV=development`, `DOBIUS_E2E_HEADLESS=1`, PATH incl. `dobius/node_modules/.bin`, `--remote-debugging-port=9334`.
3. Skip onboarding: `await window.api.onboarding.update({ closedAt: Date.now(), outcome: 'completed', lastCompletedStep: 5 })`, then reload.
4. Add a repo: `await s.addRepoPath('/private/tmp/<repo>'); await s.fetchRepos()`; worktree id is `<repoId>::<path>`.
5. Seed the board: `s.setActiveWorktree(WT); s.setActiveView('board'); const tab = s.createTab(WT)`, then `s.addCard(WT, {kind:'console', tabId: tab.id, agentKind:'blank', x,y,w,h,title})`, plus `kind:'web'` and `kind:'note'`.
6. Dismiss "Got it", drive with Playwright `connectOverCDP` from a `.mjs` inside `dobius/`, delete the script after.
TODO (Carson's OK): copy into `~/.claude/skills/learned-dobius-isolated-test-copy/SKILL.md`, replacing its "Known gap" paragraph.

## Appendix D: open questions for Carson (all in one place)

1. Does Line B replace Line A for the whole team, or stay Carson-only? (Carson decided Line B is HIS main app; the team question is still open, and Sam should agree.)
2. Keep or drop the $10 spend caps (-1.11)?
3. Close PR #4 and fork PRs #1-#5?
4. What goes under "other things" in the A menu (-1.7)?
5. Bring the 44 uncommitted files (incl. security fixes) into this copy (D2 / -1.1)?
6. Graphify vs the July "no third indexer" rule (plans/algorithm/DECISIONS.md, round 4)?
7. The video link (D3)?
8. Carson's dictated "no in house no texas": never clarified.
9. Update the test-copy skill with Appendix C?

## Phase 8: everything the algorithm put off, added back (Carson, 2026-11-21: "just add everything")

Every item from plans/algorithm/DECISIONS.md round 4 is back in scope. Folded items stay folded (primer -> 3.2,
Report a problem -> Phase 5, stale-graph rule -> 4.1, Graphify-on-every-project -> after Dobius).

| ID | Item | Needs research first? |
|---|---|---|
| 8.1 | One event log / ledger for every run (plan B3) | yes: which stores to fold in |
| 8.2 | Animated loading screen from the demo artifact (on top of the status line) | no |
| 8.3 | Separate grader agent for important tasks | no (pattern known) |
| 8.4 | Vault note per finished card | ties into 8.10 |
| 8.5 | Count non-Bash failures in the global learn hook | no |
| 8.6 | Automatic after-fix screenshot for the bug button | no (test-copy recipe, Appendix C) |
| 8.7 | Telegram approve-from-phone + /tabs /read /send | no |
| 8.8 | Turn on Laya | yes: where the model service runs |
| 8.9 | Live per-tab checklist from the agent's to-do list | yes |
| 8.10 | **Agent activity feed** (see plan below) | yes |
| 8.11 | Run adoption gate | yes |
| 8.12 | Cloud job buttons (submit / cancel / retry) | no |
| 8.13 | Hook install status in Settings | no |
| 8.14 | Usage detail table (keep, wire it, not delete) | no |
| 8.15 | ADAM voice client + the hands-free voice branch `feat/adam-voice-control` (33 commits, 44 files never landed: wake word, barge-in, local speech, voice brain, proactive watcher, shell tool) | yes: what still fits after the Hermes voice rework |
| 8.16 | Replay tests for agent instructions | yes: build the frozen task set |
| 8.17 | **Weekly skill cleanup** (see plan below) | yes |
| 8.18 | **Gmail intake** (see plan below) | yes |
| 8.19 | Command Center backed by real tasks | yes |
| 8.20 | Delete with OK: fake Operations dashboard, legacy dialogs, comms identity IPC, test-only chat projections | no |

### Plan: Gmail intake (8.18)
Goal: mail from tracked contacts becomes Kanban cards automatically, suggestions first.
Research questions:
1. Which accounts: the google-workspace MCP is connected as aiimitch38@gmail.com; Line A has GWS multi-account work (GWS-MULTI-ACCOUNT-PLAN.md) and Line B has `main/asana` token patterns. Pick one auth path.
2. Who counts as "tracked": reuse the memory note proactive-dobius-decisions (tracked-contact iMessage/Gmail -> Kanban).
3. Where cards land: `main/vertex/vertex-task-store.ts` / `main/ipc/vertex-tasks.ts` (Kanban).
4. Safety: read-only Gmail scope, no auto-reply, email text treated as data (prompt-injection), dedupe by message id.
Build sketch: poller (copy imessage bridge watermark + at-most-once) -> classifier (cheap model, suggestion) -> card with link back to the thread -> Carson approves.

### Plan: weekly skill cleanup (8.17)
Goal: a weekly report that proposes merges, deletions and new skills. Never deletes on its own.
Research questions:
1. Where the duplicate `subagent-prompt-engineer-skill-<hash>` entries come from (not in ~/.claude/skills; likely a plugin or generated dir).
2. Inputs: ~/.claude/skills/LEARNED.md (73 learned skills), ~/.claude/algorithm/command-log.tsv, vault Inbox/Sessions notes.
3. Output: one markdown report + the skill-creator drafts, Carson approves each.
Build sketch: Dobius automation (weekly) -> agent run with read-only tools -> report into the vault Inbox + a Kanban card.

### Plan: agent activity feed (8.10)
Goal: one live feed of what every agent is doing, in the app and mirrored to the Obsidian vault.
Research questions:
1. Find the old writer of `~/Obsidian Vault/AI Research/Dobius Agent Activity/` (stopped 2026-10-23; not in dobius/src or ~/.claude/hooks; check ADAM / Hermes / Line A).
2. Sources: `main/agents/agent-run-event-journal.ts`, automation runs, orchestration messages, terminal agent status hooks.
3. Shape: in-app feed panel (Knowledge page or board side app) + daily vault note; same events, one writer.
Depends on 8.1 (event log) for the single writer, but a v1 can read the existing journals.

## Phase 9: make the board findable (from Claude 5's attempt to orchestrate, 2026-11-21)

What happened: Carson asked Claude 5 (a console on the FEATURES-HUB board) to hand tasks to Plan 2, Build 2, Test 2 and
Docs 1. It took ~10 commands to work out which board it was on, and the four consoles turned out to have no live terminal.
Findings (verified):
- No `dobius board` command exists; the CLI cannot list cards or find a card by name.
- `terminal list` shows tab titles, never card names; 15 of 19 terminals in the worktree are idle shells with near-identical titles.
- Card -> terminal mapping exists only in the renderer (`use-orchestrator-thread.ts:72-110`: card.tabId -> terminal.list -> handle at send time) and in `dobius-data.json` (`ui.boardsByWorktree`).
- Handles are not stable: the board's 18:24 and 18:26 broadcasts went to 16 different handles; all now stale or exited. A console's env handle (`DOBIUS_TERMINAL_HANDLE`) differs from its `terminal list` handle.
- A card whose terminal exited still looks alive on the board (scrollback + "Done" in the orchestrator list).
- Restarting a board console gives it a NEW tabId and handle (2026-11-21: Plan 2 e5cdf5e1 -> a449e538, etc.), so any saved mapping goes stale on restart.

| ID | Fix | Where | Size |
|---|---|---|---|
| 9.1 | `dobius board list [--json]`: cards with name, kind, agent, tabId, live handle (or "not running") | new CLI spec + RPC reading the board slice from main | M |
| 9.2 | `dobius board send --card "<name>" --text ... [--enter]` and orchestration addressing `card:<name>` resolved at send time | same RPC; reuse the renderer's tabId->handle logic in main | M |
| 9.3 | Tell each console who it is: `DOBIUS_BOARD_CARD_ID`, `DOBIUS_BOARD_CARD_TITLE`, `DOBIUS_BOARD_ID` env, plus a line in the workspace brief | PTY env injection (where DOBIUS_TAB_ID is set) | S |
| 9.4 | Stable address per console: accept `tab:<tabId>` as a handle everywhere | terminal handle resolver | S |
| 9.5 | Show dead consoles honestly: card badge "not running" + a Restart button; orchestrator list says "Exited", not "Done" | board console card + OrchestratorCard | S |
| 9.6 | CLI path into a board orchestrator: `dobius orchestration send --to board:<orchestratorCardId>` fans out to its wired consoles, same as typing in the card | main-side relay | M |
| 9.7 | Keep a card's tabId stable across console restart, or have the card own a stable id the CLI can resolve. | card restart path + terminal handle resolver | S |
