# Workstation Build Plan

Written 2026-11-21. Owner: Carson. Status: plan only, nothing built yet.

## The one rule for this plan

Every build in this plan happens in ONE checkout, and only this one:

- Folder: `~/Projects (Code)/dobius-plus/WORKSTATION-BUILD`
- Branch: `aiimitch38-create/workstation-build`
- Based on: `fix/security-critical-20261027` at `a8cfe8be` (Carson's TypeScript app, installed as 2.1.9)
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
| D1 | Base app: this TypeScript app, or Sam's JavaScript app (origin/main, 2.2.44)? Sam should agree. | TypeScript (this plan assumes it) |
| D2 | Bring the 44 uncommitted files from the main checkout into this copy? | No, leave them |
| D3 | The video link (her 10-minute Claude Code setup), to compare against this plan | Skip the comparison |

## Phase 0: cleanup and quick wins (approved by Carson 2026-11-21)

| ID | Task | Where | Size |
|---|---|---|---|
| 0.1 | Remove the Mesh Compute settings card and its code | `renderer/src/components/communications/features/mesh-compute/`, mount at `features/settings/ui/SettingsPanels.tsx:827`, `shared/api/tauriMesh.ts` | S |
| 0.2 | Remove the Hosted Communities settings card and its code | `features/settings/ui/HostedCommunitiesSettingsCard.tsx`, mount at `SettingsPanels.tsx:833`, `HostedCommunityOnboarding.tsx` | S |
| 0.3 | Delete the ~42 unreachable Channels files. Re-check each has no importer before deleting. | `renderer/src/components/communications/features/**` | M |
| 0.4 | Install ADAM's 4 missing command wrappers: `/tabSendTo`, `/tabFocus`, `/tabRead`, `/tabOpen` | `main/dobius-cli/install-clis.ts:140-167`, routes at `main/dobius-cli/dispatch-server.ts:298-310` | S |
| 0.5 | Research: find any hands-free / voice-driven Dobius work on Sam's branches (origin) and report what it is, where, and whether it can be ported | read-only | S |

Also safe-to-delete candidates, needing Carson's OK per item: the fake Operations dashboard
(`renderer/src/components/operations/`), legacy UI orphans (CreatePullRequestDialog, LinearAgentSkillSetupPrompt,
RepoStep, FeatureTourPreview, StarNagToastHost, and others), the unused comms identity IPC
(`main/ipc/communications-identity.ts`), and test-only chat projections (`main/communications/chat/*-projection.ts`).

## Phase 1: one app (bring Sam's and Carson's work together)

Sam's JavaScript app and this TypeScript app have diverged, so Sam's work is PORTED (rebuilt here), not merged.

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
