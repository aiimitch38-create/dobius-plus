# CLI coverage audit (plan row 9.8, step 1)

Date: 2026-11-22. Read-only audit of branch `aiimitch38-create/workstation-build` at `6af25af3`.
Goal: every Dobius+ feature reachable from the `dobius` command line, so ADAM and other agents can drive the whole app.
Method borrowed from HKUDS/CLI-Anything: analyze (this file), design, implement, tests, SKILL.md. Built in our own TypeScript CLI (`dobius/src/cli/`), not its Python wrapper.

## How to read this

There are three layers in the app, and a feature can stop at any of them.

- **CLI command**: a `dobius ...` command. Defined in `dobius/src/cli/specs/*.ts`, run by `dobius/src/cli/handlers/*.ts`.
- **RPC method** (remote procedure call: a named function the running app answers over its local socket). Listed in `dobius/src/main/runtime/rpc/methods/index.ts` (`ALL_RPC_METHODS`). The CLI is a thin client over these. An RPC method with no CLI command is the cheapest gap to fill: only a spec + handler are needed.
- **IPC channel** (inter-process communication: the private wire between the app window and the app's main process). Listed in `dobius/src/preload/index.ts`. A feature that exists only here needs a new RPC method first (bigger job: the logic often lives behind an `ipcMain.handle` that must be moved or shared).
- **UI-only**: logic lives in the React window (for example the Board command-bar planner in `renderer/src/components/board/board-planner/`). Hardest to reach: main has to ask the window to do it, or the logic moves to main.

Column codes:

- **Coverage**: `CLI` (command exists), `RPC-only`, `IPC-only`, `UI-only`, `In flight` (on an unmerged branch, not a gap).
- **JSON**: every CLI command accepts `--json` (it is in `GLOBAL_FLAGS`, `cli/args.ts:19`). The one exception is `dobius claude-teams`, which passes its arguments to Claude Code. Rows without a command show `-`.
- **Risk** (for gating the agent key): `R` read-only, `M` modifies app state, `H` runs host commands, sends data off the Mac, or spends money/credits, `D` destructive (deletes, kills, discards, or cannot be undone).
- **ADAM**: priority for ADAM running Carson's work from voice/thread. `high`, `med`, `low`, `skip` (UI-only by nature, or a human-only action by design or by house rule).

## Totals

Enumerated by script, not estimated:

- **CLI commands**: 233 command paths across 23 spec files.
- **RPC methods**: 578 in `main/runtime/rpc/methods/` plus `main/communications/huddles/`. About 100 more in the other communications method files (estimated: counted by quoted dotted names, which may include a few non-method strings).
- **IPC channels** (renderer to main): 766 unique `invoke`/`send` channel names in `preload/`. Some are reply/ack plumbing, not features.

Feature rows in this audit (one row = one user-facing capability, so these are a judgment-based grouping, not a raw count):

| Coverage | Rows |
|---|---|
| CLI | 56 |
| RPC-only | 86 (includes 2 rows reachable by either RPC or IPC) |
| IPC-only | 76 |
| UI-only | 22 (includes 1 mixed UI/IPC row) |
| In flight | 8 |
| Could not determine | 1 |
| **Total** | **249** |

The browser (about 80 commands), computer use (14) and emulator (17) groups are each counted as a few rows, because they are already complete.

### What already gates ADAM today

`main/jarvis/agent-context.ts:37` (`DENIED_VERBS`) refuses any `dobius <group> <verb>` where the verb is `rm, remove, delete, reset, stop, close, run-stop, setup-delete, set-base-ref`. It is verb-name based, so a destructive command with a harmless verb name (for example a future `git discard`) would pass. The design step should replace this with the risk class from this audit, enforced in the RPC layer next to the scoped agent key (in flight on `wb/runtime-key-guard`).

---

## 1. App and runtime

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Launch the app and wait for it | CLI | `dobius open` | yes | M | high |
| App, runtime and window readiness | CLI | `dobius status` | yes | R | high |
| Headless runtime server | CLI | `dobius serve` | yes | H | low |
| Memory diagnostics | CLI | `dobius diagnostics memory` | yes | R | low |
| System monitor (CPU, memory, load) | RPC-only | `system.monitor.status` | - | R | med |
| Detect installed agents (Claude, Codex, Hermes...) | RPC-only | `preflight.check`, `preflight.detectAgents`, `preflight.refreshAgents` | - | R | med |
| Host platform facts (WSL, PowerShell, Git Bash) | RPC-only | `host.platform`, `host.wsl.*` | - | R | low |
| Relaunch / reload the app | IPC-only | `app:relaunch`, `app:reload`, `app:restart` | - | D | low |
| Collect / upload a diagnostics bundle | IPC-only | `diagnostics:collectBundle`, `diagnostics:uploadBundle` | - | H | low |

## 2. Terminals and tabs

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| List / show terminals | CLI | `dobius terminal list`, `terminal show` | yes | R | high |
| Read a terminal's output | CLI | `dobius terminal read` | yes | R | high |
| Type into a terminal | CLI | `dobius terminal send` | yes | H | high |
| Wait for output or exit | CLI | `dobius terminal wait` | yes | R | high |
| New terminal tab | CLI | `dobius terminal create` | yes | H | high |
| Focus / switch / rename / close / stop | CLI | `dobius terminal focus`, `switch`, `rename`, `close`, `stop` | yes | M (close, stop = D) | high |
| Start Claude Agent Teams in this pane | CLI | `dobius claude-teams` | no | H | low |
| Clear a terminal's buffer | RPC-only | `terminal.clearBuffer` | - | M | low |
| Is an agent running here, and what is it doing | RPC-only | `terminal.isRunningAgent`, `terminal.agentStatus`, `terminal.inspectProcess` | - | R | high |
| List every tab (terminal, browser, markdown, simulator) | RPC-only | `session.tabs.listAll`, `session.tabs.list` | - | R | high |
| Activate / close any tab type | RPC-only | `session.tabs.activate`, `session.tabs.close` | - | M | med |
| Move a tab to another group/window | RPC-only | `session.tabs.move` | - | M | low |
| Tab properties (pin, color, label) | RPC-only | `session.tabs.setTabProps` | - | M | low |
| Read / save a markdown tab | RPC-only | `markdown.readTab`, `markdown.saveTab` | - | M | med |
| Reopen last closed tab | UI-only | keybinding `tab.reopenClosed` | - | M | low |
| New agent / browser / simulator / markdown tab | UI-only | keybindings `tab.newAgent`, `tab.newBrowser`, ... (CLI covers terminal and browser tabs) | - | M | med |
| Tear a terminal off into its own window | IPC-only | `window:tearOffTerminal` | - | M | skip |
| Prompt library (list, save, inject into a tab) | IPC-only | `prompts:list`, `prompts:save`, `prompts:inject`, `prompts:delete` | - | H | med |
| Kill all / one PTY from the management panel | IPC-only | `pty:management:killAll`, `pty:management:killOne`, `pty:management:restart` | - | D | low |
| Stable `tab:<tabId>` address for any command | In flight | `wb/board-cli-2` (9.4) | - | - | high |
| `terminal.resolveTab` | In flight | `wb/board-cli-2` | - | R | high |
| Terminal display mode / fit | RPC-only | `terminal.setDisplayMode`, `terminal.restoreFit` | - | M | skip |
| Search / copy / paste / zoom in a terminal | UI-only | keybindings `terminal.search`, `terminal.copySelection` | - | - | skip |

## 3. Panes and splits

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Split a pane right / down | CLI | `dobius terminal split` | yes | H | high |
| Set a pane title | CLI | `dobius terminal rename` | yes | M | med |
| Equalize / expand / resize panes | RPC-only | `session.tabs.updatePaneLayout` | - | M | low |
| Focus next / previous pane | UI-only | keybindings (CLI `terminal focus` by handle covers the need) | - | M | skip |
| Close a pane | UI-only | keybinding `terminal.closePane` (CLI `terminal close` closes by handle) | - | D | low |

## 4. Worktrees and workspaces

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| List / show / current worktree | CLI | `dobius worktree list`, `show`, `current` | yes | R | high |
| Create a worktree (optionally with agent) | CLI | `dobius worktree create` | yes | H | high |
| Set name, comment, card status | CLI | `dobius worktree set` | yes | M | high |
| Remove a worktree | CLI | `dobius worktree rm` | yes | D | med |
| Running processes per worktree | CLI | `dobius worktree ps` | yes | R | high |
| Put a workspace to sleep (hibernate) | RPC-only | `worktree.sleep` | - | M | high |
| Wake a sleeping workspace | RPC-only | `worktree.activate` | - | M | high |
| Lineage (parent/child worktrees) | RPC-only | `worktree.lineageList` | - | R | med |
| Worktrees found on disk but not managed | RPC-only | `worktree.detectedList` | - | R | low |
| Delete a preserved branch | RPC-only | `worktree.forceDeleteBranch` | - | D | skip |
| Listening ports per workspace, kill a port | RPC-only | `workspacePorts.scan`, `workspacePorts.kill` | - | R / D | med |
| Folder workspaces (non-git folders) | RPC-only | `folderWorkspace.list`, `create`, `update`, `delete` | - | M | med |
| Workspace cleanup suggestions | IPC-only | `workspaceCleanup:scan`, `dismiss` | - | R | low |
| Disk space used per workspace | IPC-only | `workspaceSpace:analyze` | - | R | med |
| Ephemeral VMs: provision, suspend, resume, cleanup | IPC-only | `ephemeralVm:*` (CLI has only `vm recipe doctor`) | - | H | low |
| Worktree palette / quick open / reorder | UI-only | keybindings `worktree.palette`, `worktree.quickOpen` | - | - | skip |

## 5. Repos and projects

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| List / add / show repos | CLI | `dobius repo list`, `add`, `show` | yes | R / M | high |
| Default base branch, search refs | CLI | `dobius repo set-base-ref`, `search-refs` | yes | M / R | med |
| Projects and host setups | CLI | `dobius project list`, `setups`, `setup-create`, `setup-clone`, `setup-existing-folder`, `setup-update`, `setup-delete` | yes | M (delete = D) | med |
| Remote environments (paired hosts) | CLI | `dobius environment list`, `add`, `show`, `rm` | yes | M | low |
| Create a new repo / clone one | RPC-only | `repo.create`, `repo.clone` | - | H | med |
| Rename, color, icon a repo | RPC-only | `repo.update` | - | M | low |
| Remove a repo from Dobius+ | RPC-only | `repo.rm` | - | D | low |
| Project groups (folders in the sidebar) | RPC-only | `projectGroup.*` | - | M | low |
| Repo setup hooks and scripts | RPC-only | `repo.hooks`, `repo.hooksCheck`, `repo.setupScriptImports` | - | R | low |
| Sparse checkout presets | RPC-only | `repo.sparsePresets`, `repo.saveSparsePreset` | - | M | low |
| SSH targets: state, connect | RPC-only | `ssh.getState`, `ssh.connect` | - | H | low |
| Pick a folder with a dialog | IPC-only | `repos:pickFolder` | - | - | skip |

## 6. Board, consoles, cards, orchestrators

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Spawn a worker / lead console with a prompt | CLI | `dobius board spawn-console` | yes | H | high |
| List console cards with live handle | CLI | `dobius board consoles` | yes | R | high |
| Type into a card by id or title | CLI | `dobius board send` | yes | H | high |
| Open a web tile for an agent | CLI | `dobius board open-tile` | yes | M | high |
| Pause / stop an agent on Board tiles | CLI | `dobius board agent-control` | yes | M | med |
| Resolve one console / agent state | RPC-only | `board.resolveConsole`, `board.agentState` | - | R | med |
| List ALL cards (notes, markdown, web, groups, not just consoles) | UI-only | Board store in the window (plan 9.1) | - | R | high |
| Restart a console card | UI-only | `OrchestratorCard.tsx:142`, planner `restart` | - | H | high |
| Kill / close a card | UI-only | planner `kill` | - | D | med |
| Rename a card | UI-only | planner `rename` | - | M | med |
| Add a note / markdown card | UI-only | planner `note`, `markdown` | - | M | med |
| Group / explode cards | UI-only | planner `group`, `explode` | - | M | low |
| Board status / mission report | UI-only | planner `status`, `report` (`mission-report.ts`) | - | R | high |
| Run a free-text Board command ("tell builder 1 to...") | UI-only | `board-planner/use-board-planner.ts` | - | H | med |
| Undo / redo a Board action | UI-only | planner `undo`, `redo` | - | M | low |
| Board snapshots: capture, list, read | IPC-only | `boardSnapshots:capture`, `list`, `read` | - | R | med |
| Sync console tiles with crew | IPC-only | `agents:syncConsoleTiles` | - | M | skip |
| Leads (Hermes orchestrator): init, start, stop, status | CLI | `dobius lead init`, `start`, `stop`, `status` | yes | H | high |
| Fan out to a board orchestrator: `orchestration send --to board:<id>` | In flight | `wb/board-cli-2` (9.6) | - | H | high |
| Card address survives a console restart | In flight | `wb/board-cli-2` (9.7) | - | - | high |
| Resume / take over / approve / deny an agent | UI-only | Board window only, by design (`specs/board.ts:83`) | - | M | skip |
| Drag, zoom, arrange the canvas | UI-only | canvas | - | - | skip |

## 7. Kanban tasks and work trackers

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| List / show cards | CLI | `dobius tasks list`, `show` | yes | R | high |
| Create a card | CLI | `dobius tasks create` | yes | M | high |
| Claim, heartbeat, release, complete, block | CLI | `dobius tasks claim`, `heartbeat`, `release`, `complete`, `block` | yes | M | high |
| Attach, review, comment | CLI | `dobius tasks attach`, `review`, `comment` | yes | M | high |
| Edit a card's title, body, labels, assignee | IPC-only | `vertexTasks:update` | - | M | high |
| Move a card to another column | IPC-only | `vertexTasks:move` | - | M | high |
| Delete a card | IPC-only | `vertexTasks:remove` | - | D | low |
| Capture a window screenshot onto a card | IPC-only | `vertexTasks:captureWindow` | - | M | med |
| Read a card attachment | IPC-only | `vertexTasks:readAttachment` | - | R | med |
| Release claims left by crashed agents | IPC-only | `vertexTasks:releaseInterruptedClaims` | - | M | low |
| Auto-start a fixing agent per bug card | In flight | `wb/bug-autofix` | - | H | med |
| Linear issues (search, create, status, labels, comments...) | CLI | `dobius linear ...` (23 commands) | yes | M | med |
| GitHub issues: list, create, update, comment | RPC-only | `github.listIssues`, `github.createIssue`, `github.updateIssue`, `github.addIssueComment` | - | M | med |
| GitHub Projects boards | RPC-only | `github.project.*` | - | M | low |
| Jira issues | RPC-only | `jira.*` | - | M | low |
| GitLab issues / MRs | RPC-only | `gitlab.*` | - | M | low |
| Asana queue: list, refresh, requeue, mark local done | IPC-only | `asana:listTasks`, `asana:refresh`, `asana:requeueTask`, `asana:markLocalDone` | - | M | med |
| Asana: complete a task in Asana | IPC-only | `asana:completeTask` | - | D | skip (house rule: never auto-close Asana) |

## 8. Agents, custom agents, crew, runs

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Custom agents: list, show, create, edit, remove | CLI | `dobius agents list`, `show`, `create`, `edit`, `remove` | yes | M (remove = D) | med |
| Run a custom agent, list runs | CLI | `dobius agents run`, `agents runs` | yes | H | high |
| A run's outbox (what it produced) | RPC-only | `agent.runOutbox` | - | R | high |
| Pause / resume the whole crew (execution gate) | IPC-only | `agents:setPaused`, `agents:getPaused`, `agents:getExecutionState` | - | M | high |
| Stop / yield / control one crew run | IPC-only | `agents:stop`, `agents:yield`, `agents:control` | - | D (stop) / M | high |
| Drafts waiting for approval: list, approve, discard | IPC-only | `agents:listDrafts`, `agents:approveDraft`, `agents:discardDraft` | - | H (approve sends) | high (list); approve = human-only by default |
| Decisions waiting on Carson: list, resolve | IPC-only | `agents:listDecisions`, `agents:resolveDecision` | - | M | high |
| Morning briefing: list, dismiss | IPC-only | `agents:listBriefing`, `agents:dismissBriefing` | - | R / M | high |
| Crew notifications: list, mark read | IPC-only | `agents:listNotifications`, `agents:markNotificationsRead` | - | R / M | med |
| Crew files (agent memory/instructions): read, write | IPC-only | `agents:readCrewFiles`, `agents:writeCrewFile`, `agents:readFiles`, `agents:writeFile` | - | M | med |
| Harnesses (Hermes, Codex runners): list, save, run, stop, status | IPC-only | `agents:listHarnesses`, `agents:saveHarness`, `agents:runHarness`, `agents:stopHarness`, `agents:harnessStatuses` | - | H | med |
| Provider API keys: status | IPC-only | `agents:providerKeyStatus` | - | R | low |
| Provider API keys: save, clear | IPC-only | `agents:saveProviderKey`, `agents:clearProviderKey` | - | D | skip (secret) |
| Reset an agent's session | IPC-only | `agents:resetSession` | - | D | low |
| Agent teams: list, show, create, update, delete | RPC-only | `team.*` | - | M | med |
| Export / import an agent or team snapshot | RPC-only | `agent.snapshot.*`, `team.snapshot.*` | - | M | low |
| Agent status hooks on / off / status | CLI | `dobius agent hooks on`, `off`, `status` | yes | M | low |
| Per-agent hook install status (Claude, Codex, Gemini...) | IPC-only | `agentHooks:*Status` | - | R | low |
| Claude / Codex accounts: list, switch | RPC-only | `accounts.list`, `accounts.selectClaude`, `accounts.selectCodex` | - | M | med |
| Remove a Claude / Codex account | RPC-only | `accounts.removeClaude`, `accounts.removeCodex` | - | D | skip |
| ADAM cloud children: submit, look up, seal intent | CLI | `dobius submit-adam-child`, `lookup-adam-child`, `seal-adam-intent` | yes | H | high |
| Cloud jobs: list, get, events, submit, cancel, retry | RPC-only | `jobs.*` | - | H | med |
| Agent approvals per run (communications) | RPC-only | `agentApprovals.listForRun`, `grant`, `deny` | - | M | med |
| Scoped agent key with RPC allowlist | In flight | `wb/runtime-key-guard` | - | - | high |

## 9. Automations and loops

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| List / show / create / edit / remove | CLI | `dobius automations list`, `show`, `create`, `edit`, `remove` | yes | M (remove = D) | high |
| Turn on / off | CLI | `dobius automations edit <id> --enabled / --disabled` | yes | M | high |
| Run now, list runs | CLI | `dobius automations run`, `runs` | yes | H | high |
| Loops (repeat-until-goal on a Board console) | UI-only | Board Loops studio + `plan-loop-create.ts` (saved as an automation with loop state through `automations:create` + `automations:update` IPC). CLI `create` has no loop flags | - | H | high |
| Loop state: iteration, goal drift, stop reason | IPC-only | `automations:list` carries it; `automations:goalDriftJudge` is internal | - | R | med |
| Test a precheck command | IPC-only | `automations:runPrecheck` | - | H | low |
| External automation managers (cron, launchd...) | IPC-only | `automations:listExternalManagers`, `createExternal`, `runExternalAction` | - | H | low |
| Save subscriptions (auto-run on save) | RPC-only | `saveSubscription.*` | - | M | low |

## 10. Orchestration messaging

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Send / check / reply / inbox / ask | CLI | `dobius orchestration send`, `check`, `reply`, `inbox`, `ask` | yes | H | high |
| Task DAG: create, list, update | CLI | `dobius orchestration task-create`, `task-list`, `task-update` | yes | M | high |
| Dispatch and inspect a dispatch | CLI | `dobius orchestration dispatch`, `dispatch-show` | yes | H | high |
| Coordinator run / stop | CLI | `dobius orchestration run`, `run-stop` | yes | H | med |
| Decision gates: create, list, resolve | CLI | `dobius orchestration gate-create`, `gate-list`, `gate-resolve` | yes | M | high |
| Reset messages / tasks | CLI | `dobius orchestration reset` | yes | D | skip |
| ADAM's one thread across every project | In flight | `wb/adam-thread` | - | - | high |

## 11. Built-in browser and web tiles

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Navigate, snapshot, click, type, fill, wait, screenshot, eval... | CLI | about 80 top-level commands (`goto`, `snapshot`, `click`, `fill`, `type`, `wait`, `screenshot`, `eval`, `exec`, ...) | yes | H (eval, exec) / M | high |
| Browser tabs and profiles | CLI | `dobius tab list`, `create`, `switch`, `close`, `tab profile ...` | yes | M | high |
| Cookies, storage, headers, offline, device, intercept | CLI | `dobius cookie ...`, `storage ...`, `set ...`, `intercept ...` | yes | M | med |
| Import cookies/profile from Chrome, Safari... | RPC-only | `browser.profileDetectBrowsers`, `browser.profileImportFromBrowser` | - | H | low |
| Clear default cookies | RPC-only | `browser.profileClearDefaultCookies` | - | D | low |
| Live screencast | RPC-only | `browser.screencast` | - | R | skip |
| DevTools, grab element, address bar | UI-only / IPC-only | `browser:openDevTools`, keybinding `browser.grabElement` | - | - | skip |

## 12. Computer use and emulators

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Apps, windows, app state, click, type, keys, scroll, drag, set value | CLI | `dobius computer ...` (14 commands) | yes | H | high |
| Permission status | CLI | `dobius computer permissions` | yes | R | med |
| Open permission setup / reset | IPC-only | `computerUsePermissions:openSetup`, `reset` | - | M | low |
| Desktop screen stream | RPC-only | `screen.stream` | - | R | skip |
| Android / iOS emulator control | CLI | `dobius emulator ...` (17 commands) | yes | H | low |
| List iOS simulators, availability | RPC-only | `emulator.listSimulators`, `emulator.availability` | - | R | low |

## 13. Voice, ADAM, Jarvis

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Ask ADAM in text (from a terminal or another agent) | IPC-only | `jarvis:askAdamText`, `jarvis:ask`, `jarvis:cancelAsk` | - | H | high |
| Make ADAM say something aloud | IPC-only | `jarvis:speak` | - | M | med |
| Voice status / set mode | IPC-only | `jarvis:status`, `jarvis:setMode` | - | R / M | med |
| ADAM's conversation memory and context | IPC-only | `jarvis:conversationMemory`, `jarvis:agentContext`, `jarvis:getAdamProjectDirectory` | - | R | med |
| ADAM self-edit: propose, apply, discard, undo | IPC-only | `jarvis:proposeSelfEdit`, `applySelfEdit`, `discardSelfEdit`, `undoSelfEdit` | - | D | low (apply = human-only) |
| Voice conductor intent / reply | RPC-only | `voice.intent`, `voice.reply` | - | H | med |
| Speech models: list, download, delete | RPC-only | `speech.models.*` | - | M | low |
| Dictation start / stop | RPC-only | `speech.dictation.*` | - | - | skip |
| Huddles: start, join, leave, add agent, speak | RPC-only | `huddle.*` | - | H | low |
| ElevenLabs / OpenAI key save, clear | IPC-only | `jarvis:saveElevenLabsKey`, `speech:saveOpenAiApiKey` | - | D | skip (secret) |
| Open orb, push-to-talk, live session | IPC-only | `jarvis:openOrb`, `jarvis:pressPtt`, `jarvis:liveSessionConnect` | - | - | skip |

## 14. Settings and preferences

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Read settings | RPC-only | `settings.get` | - | R | high |
| Change a setting | RPC-only | `settings.update` | - | M | med |
| Read / change window UI state (open view, sidebars) | RPC-only | `ui.get`, `ui.set` | - | M | med |
| Keyboard shortcuts: read, rebind | IPC-only | `keybindings:get`, `keybindings:setAction` | - | M | low |
| Notification permission / settings | IPC-only | `notifications:getPermissionStatus`, `requestPermission` | - | M | low |
| Show a desktop notification | IPC-only / RPC-only | `notifications:dispatch`; `nativeUx.showNotification` | - | M | med |
| Secret storage status | IPC-only | `settings:getSecretStorageStatus` | - | R | low |
| Fonts, theme import, onboarding, appearance | IPC-only | `settings:listFonts`, `settings:previewWarpThemeImport`, `onboarding:*` | - | - | skip |
| Mobile pairing: QR, devices, revoke | IPC-only | `mobile:getPairingQR`, `mobile:listDevices`, `mobile:revokeDevice` | - | D (revoke) | low |
| Destinations: list, save, test | IPC-only | `destinations:*` (purpose not determined in this audit) | - | M | low |

## 15. Snooze and hibernation

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Sleep / wake a workspace | RPC-only | `worktree.sleep`, `worktree.activate` (see section 4) | - | M | high |
| List sleeping workspaces | RPC-only | likely a field on `worktree.list` (unverified) | - | R | high |
| Snooze a tab until a time, list, put back | In flight | `wb/snooze-tabs` adds IPC `tabSnooze:add`, `list`, `take`, `putBack`, `setTime`, `discard` (IPC only; needs RPC + CLI after merge) | - | M | med |
| Snooze a reminder (communications) | UI-only | `communications/features/reminders/` | - | M | low |

## 16. Git and pull requests

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Open a changed file / diff in the editor | CLI | `dobius file open`, `file diff`, `file open-changed` | yes | R | med |
| Status, diff, history, branches | RPC-only | `git.status`, `git.diff`, `git.history`, `git.localBranches`, `git.branchCompare` | - | R | high |
| Stage / unstage | RPC-only | `git.stage`, `git.bulkStage`, `git.unstage` | - | M | high |
| Commit | RPC-only | `git.commit` | - | M | high |
| AI commit message / PR fields | RPC-only | `git.generateCommitMessage`, `git.generatePullRequestFields` | - | H (spends tokens) | med |
| Fetch, pull, fast-forward, rebase from base | RPC-only | `git.fetch`, `git.pull`, `git.fastForward`, `git.rebaseFromBase` | - | H | med |
| Push | RPC-only | `git.push` | - | H | med (gate: fork-only rule) |
| Checkout a branch | RPC-only | `git.checkout` | - | M | med |
| Discard changes | RPC-only | `git.discard`, `git.bulkDiscard` | - | D | skip |
| Abort merge / rebase | RPC-only | `git.abortMerge`, `git.abortRebase` | - | D | low |
| PR for this branch, checks, comments | RPC-only | `github.prForBranch`, `github.prChecks`, `github.prCheckDetails`, `github.prComments` | - | R | high |
| Create a PR | RPC-only | `hostedReview.create`, `hostedReview.getCreationEligibility` | - | H | med |
| Rerun failed checks | RPC-only | `github.rerunPRChecks` | - | H | med |
| Edit PR title, reviewers, state | RPC-only | `github.updatePR`, `github.requestPRReviewers`, `github.updatePRState` | - | M | low |
| Review comments: add, reply, resolve | RPC-only | `github.addPRReviewComment`, `addPRReviewCommentReply`, `resolveReviewThread` | - | M | med |
| Merge a PR / auto-merge | RPC-only | `github.mergePR`, `github.setPRAutoMerge` | - | D | skip (house rule: human merges) |
| GitLab MRs | RPC-only | `gitlab.*` | - | M | low |
| Link to a file / commit on GitHub | RPC-only | `git.remoteFileUrl`, `git.remoteCommitUrl` | - | R | low |

## 17. Usage, limits, stats

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Activity stats summary | RPC-only | `stats.summary` | - | R | med |
| Claude usage: summary, daily, breakdown, sessions | IPC-only | `claudeUsage:getSummary`, `getDaily`, `getBreakdown`, `getRecentSessions` | - | R | med |
| Codex / OpenCode usage | IPC-only | `codexUsage:*`, `openCodeUsage:*` | - | R | med |
| Rate limits left per account (am I out of credits?) | IPC-only | `rateLimits:get`, `rateLimits:refresh` | - | R | high |
| GitHub API budget | RPC-only | `github.rateLimit` | - | R | low |

## 18. Notes, knowledge, files, skills

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Knowledge cabinet: tree, read | IPC-only | `knowledge:tree`, `knowledge:read` | - | R | high |
| Read / write project notes and any file | RPC-only | `files.read`, `files.write`, `files.readDir`, `files.stat` | - | R / M | med |
| Search files | RPC-only | `files.search`, `files.listAll` | - | R | med |
| List markdown documents | RPC-only | `files.listMarkdownDocuments` | - | R | med |
| Rename / copy / delete files | RPC-only | `files.rename`, `files.copy`, `files.delete` | - | D (delete) | low |
| Read an agent chat transcript | RPC-only | `nativeChat.readSession` | - | R | med |
| AI vault sessions | IPC-only | `aiVault:listSessions` | - | R | low |
| Canvas notes (communications) | RPC-only | `canvas.*` | - | M | low |
| Run a notebook Python cell | IPC-only | `notebook:runPythonCell` | - | H | skip |
| Discover installed skills | RPC-only | `skills.discover` | - | R | med |
| Install bundled skills | IPC-only | `skills:installBundled` | - | M | low |
| Export HTML to PDF | IPC-only | `export:html-to-pdf` | - | M | low |
| Data catalog (shared folders for phone) | RPC-only | `data.catalog.*` | - | M | low |

## 19. Communications

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Workflows: list, show, create, update, trigger, runs | RPC-only | `workflow.*` | - | H | low |
| Channel templates | RPC-only | `channelTemplate.*` | - | M | low |
| Identity: sign out, export, import, backups | RPC-only | `communications.identity.*` | - | D | skip (secret) |
| Agent config / harness for communications agents | RPC-only | `agentConfig.*`, `agentHarness.*` | - | M | low |
| Gmail / multi-inbox intake into Kanban | could not determine | no IPC or RPC channel found by name (`gmail`, `intake`, `mail`); see `plans/research/GMAIL-INTAKE.md` | - | - | high if it exists |

## 20. Telegram and iMessage

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Telegram status, history | CLI | `dobius telegram status`, `history` | yes | R | high |
| Send an approved Telegram draft | CLI | `dobius telegram send --draft <id>` | yes | H | high |
| Telegram account: snapshot, participants | IPC-only | `telegramAccount:getSnapshot`, `getParticipants` | - | R | med |
| Approve a reply draft | IPC-only | `telegramAccount:approveDraft` | - | H | human-only by default |
| Start / stop / pause / resume auto-replies | IPC-only | `telegramAccount:startReplies`, `stopReplies`, `pause`, `resume` | - | M | med |
| Groups refresh / save | IPC-only | `telegramAccount:refreshGroups`, `saveGroups` | - | M | low |
| Sign in, code, password, consent, revoke | IPC-only | `telegramAccount:beginSignIn`, `submitCode`, `grantConsent`, `revoke` | - | D | skip (secret, human consent) |
| iMessage bridge: status, config | IPC-only | `imessageBridge:status`, `getConfig`, `updateConfig` | - | R / M | med |
| iMessage test send | IPC-only | `imessageBridge:testSend` | - | H | low |

## 21. Cloud backup

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Backup status (last run, errors) | IPC-only | `cloudBackup:getStatus` | - | R | med |
| Back up now | IPC-only | `cloudBackup:runNow` | - | H | med |
| Turn on / connect | IPC-only | `cloudBackup:setEnabled`, `cloudBackup:connect` | - | M | low |
| Export recovery key | IPC-only | `cloudBackup:exportRecoveryKey` | - | D | skip (secret) |

## 22. What's new, report a problem, updates

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| What's new: current, pending, dismiss | IPC-only | `whatsNew:getCurrent`, `getPending`, `dismiss` | - | R / M | low |
| Report a problem | IPC-only | `feedback:submit` | - | H (sends data off the Mac) | med |
| Crash reports: latest, submit, dismiss | IPC-only | `crashReports:getLatestReport`, `submit`, `dismiss` | - | H | low |
| App version, update status | IPC-only | `updater:getVersion`, `updater:getStatus` | - | R | med |
| Check / download update | IPC-only | `updater:check`, `updater:download` | - | H | low |
| Install update and restart | IPC-only | `updater:quitAndInstall` | - | D | skip |
| Install / remove the `dobius` CLI on PATH | IPC-only | `cli:install`, `cli:remove`, `cli:getInstallStatus` | - | M | low |

## 23. Window and view navigation

| Capability | Coverage | Command / backing | JSON | Risk | ADAM |
|---|---|---|---|---|---|
| Open Board / Tasks / Settings pane / a worktree, for Carson to see | UI-only | keybindings `workspace.openBoard`, `view.tasks`, `app.settings`; maybe reachable through `ui.set` (unverified which fields switch the view) | - | M | high |
| Back / forward in worktree history | CLI | `dobius back`, `forward` act on the browser; worktree history is UI-only (`worktree.history.back`) | yes | M | low |
| Sidebars, floating terminal, zoom | UI-only | keybindings `sidebar.*`, `floatingTerminal.toggle`, `zoom.*` | - | - | skip |
| Minimize / maximize window, phone visual window | IPC-only | `window:minimize`, `window:maximize`, `window:openPhoneVisual` | - | - | skip |
| Dock badge, haptics, vibrancy, tray | IPC-only / RPC-only | `app:setUnreadDockBadgeCount`, `nativeUx.*` | - | - | skip |
| Pet, star prompt | IPC-only | `pet:*`, `star-nag:*` | - | - | skip |

---

## 1. Gap list, ranked by ADAM priority

Size: S = spec + handler over an existing RPC method (about half a day with tests). M = new RPC method wrapping logic that lives behind IPC in main (move or share the function). L = logic lives in the renderer; main must ask the window (round trip like `board.spawnConsole`) or the logic must move to main.

Risk is the class the design should register for the agent key.

| # | Proposed command | Flags | Backing RPC | Size | Risk |
|---|---|---|---|---|---|
| 1 | `dobius crew pause` / `crew resume` / `crew status` | `[--reason <text>]` | new `crew.setPaused`, `crew.state` (wraps `agents:setPaused`, `agents:getExecutionState`) | M | M |
| 2 | `dobius crew decisions` / `crew decide <id>` | `--choice <value> [--note <text>]` | new `crew.listDecisions`, `crew.resolveDecision` | M | M |
| 3 | `dobius crew drafts` / `crew draft approve <id>` / `crew draft discard <id>` | | new `crew.listDrafts`, `crew.approveDraft`, `crew.discardDraft` (approve gated human-only for the agent key) | M | H |
| 4 | `dobius crew briefing` / `crew briefing dismiss <id>` | | new `crew.listBriefing`, `crew.dismissBriefing` | M | R |
| 5 | `dobius crew stop <runId>` / `crew yield <runId>` | | new `crew.stop`, `crew.yield` | M | D |
| 6 | `dobius git status` / `diff` / `log` / `branches` | `[--worktree <sel>] [--staged] [--limit <n>]` | `git.status`, `git.diff`, `git.history`, `git.localBranches` | S | R |
| 7 | `dobius git stage` / `unstage` / `commit` | `<paths...>`, `--message <text>` / `--generate` | `git.stage`, `git.bulkStage`, `git.unstage`, `git.commit`, `git.generateCommitMessage` | S | M |
| 8 | `dobius pr show` / `pr checks` / `pr comments` | `[--worktree <sel>]` | `github.prForBranch`, `github.prChecks`, `github.prCheckDetails`, `github.prComments` | S | R |
| 9 | `dobius worktree sleep` / `worktree wake` / `worktree list --sleeping` | `--worktree <sel>` | `worktree.sleep`, `worktree.activate` | S | M |
| 10 | `dobius tasks update` / `tasks move` | `--id <id> [--title] [--body] [--labels] [--assignee]`, `--to <column>` | new `tasks.update`, `tasks.move` (wrap `vertexTaskStore` like the existing `tasks.*`) | S | M |
| 11 | `dobius adam ask` | `--text <utterance> [--source <name>] [--wait]` | new `adam.ask` (wraps the `jarvis:askAdamText` service call; `wb/adam-thread` touches it, so build after it merges) | M | H |
| 12 | `dobius limits` / `dobius usage` | `[--provider claude|codex|opencode] [--days <n>]` | new `usage.rateLimits`, `usage.summary` (wrap `rateLimits:get`, `claudeUsage:getSummary`...); plus existing `stats.summary` | M | R |
| 13 | `dobius knowledge tree` / `knowledge read <path>` | `[--depth <n>]` | new `knowledge.tree`, `knowledge.read` | M | R |
| 14 | `dobius board list` (all cards) + `board restart` / `board rename` / `board note` / `board close` | `--card <id-or-title>`, `--title`, `--text` | new `board.listCards`, `board.cardAction` (main asks the Board window, same pattern as `board.spawnConsole`). Plan rows 9.1 and the planner verbs | L | M (close = D) |
| 15 | `dobius automations create --loop` | `--goal <text> --max-iterations <n> --stop-when <text> --card <id>` | extend `automation.create` / `automation.update` with the loop fields in `shared/automation-loops.ts` | M | H |
| 16 | `dobius settings get` / `settings set` | `[<key>]`, `<key> <json-value>` | `settings.get`, `settings.update` (set needs a key allowlist: no secrets, no gate toggles) | S | M |
| 17 | `dobius view open` | `--view board|tasks|settings[:<pane>]|worktree --worktree <sel>` | `ui.set` if it switches views (unverified), else new `ui.navigate` sent to the window | M | M |
| 18 | `dobius tab list --all` / `tab activate` | `--worktree <sel>`, `--tab <id>` | `session.tabs.listAll`, `session.tabs.activate` (note: `dobius tab ...` today means BROWSER tabs; name these `dobius tabs ...` or `terminal tabs` to avoid a clash) | S | R / M |
| 19 | `dobius terminal agent` | `--terminal <handle>` | `terminal.agentStatus`, `terminal.isRunningAgent` | S | R |
| 20 | `dobius agents outbox <runId>` | | `agent.runOutbox` | S | R |
| 21 | `dobius notify` | `--title <t> --body <b>` | `nativeUx.showNotification` | S | M |
| 22 | `dobius adam say` / `adam status` / `adam mode` | `--text`, `--mode <m>` | new `adam.speak`, `adam.status`, `adam.setMode` | M | M |
| 23 | `dobius pr create` / `pr rerun-checks` / `pr comment` | `--title --body [--draft]` | `hostedReview.create`, `github.rerunPRChecks`, `github.addPRReviewCommentReply` | S | H |
| 24 | `dobius git fetch` / `pull` / `push` | `[--worktree <sel>]` | `git.fetch`, `git.pull`, `git.push` (push gated: fork-only remote) | S | H |
| 25 | `dobius accounts list` / `accounts use` | `--claude <id>` / `--codex <id>` | `accounts.list`, `accounts.selectClaude`, `accounts.selectCodex` | S | M |
| 26 | `dobius telegram replies start|stop|pause|resume` / `telegram snapshot` | | new RPC wrapping `telegramAccount:*` | M | M |
| 27 | `dobius imessage status` | | new RPC wrapping `imessageBridge:status` | M | R |
| 28 | `dobius backup status` / `backup run` | | new RPC wrapping `cloudBackup:getStatus`, `runNow` | M | R / H |
| 29 | `dobius version` / `update status` | | new RPC wrapping `updater:getVersion`, `getStatus` | M | R |
| 30 | `dobius feedback` | `--text <t> [--include-diagnostics]` | new RPC wrapping `feedback:submit` | M | H |
| 31 | `dobius ports` / `ports kill` | `--worktree <sel>`, `--port <n>` | `workspacePorts.scan`, `workspacePorts.kill` | S | R / D |
| 32 | `dobius file read` / `file write` / `file search` | `<path>`, `--stdin`, `--query` | `files.read`, `files.write`, `files.search` | S | R / M |
| 33 | `dobius skills list` | | `skills.discover` | S | R |
| 34 | `dobius teams list|show|create|edit|remove` | | `team.*` | S | M |
| 35 | `dobius jobs list|show|cancel|retry` | | `jobs.*` | S | H |
| 36 | `dobius system` / `dobius preflight` | | `system.monitor.status`, `preflight.check` | S | R |
| 37 | `dobius prompts list|save|inject` | `--terminal <handle>` | new RPC wrapping `prompts:*` | M | H |
| 38 | `dobius board snapshots` | `capture|list|read` | new RPC wrapping `boardSnapshots:*` | M | R |
| 39 | `dobius tabs snooze` / `unsnooze` / `snoozed` | `--tab <id> --until <time>` | new RPC over the `tabSnooze` store once `wb/snooze-tabs` merges | M | M |
| 40 | `dobius repo create` / `repo clone` / `repo update` | | `repo.create`, `repo.clone`, `repo.update` | S | H |

Deliberately not proposed (keep human-only or UI-only): PR merge and auto-merge, Asana complete, git discard, provider/voice keys, Telegram sign-in and consent, communications identity, cloud-backup recovery key, install-update-and-restart, approving ADAM self-edits, Board resume/take over/approve/deny, canvas drag/zoom/sidebars/window chrome.

### Top 15 (ADAM high first)

1. `crew pause|resume|status` (M)
2. `crew decisions` / `crew decide` (M)
3. `crew drafts` / approve / discard (M)
4. `crew briefing` (M)
5. `crew stop|yield` (M)
6. `git status|diff|log|branches` (S)
7. `git stage|unstage|commit` (S)
8. `pr show|checks|comments` (S)
9. `worktree sleep|wake|--sleeping` (S)
10. `tasks update|move` (S)
11. `adam ask` (M, after `wb/adam-thread`)
12. `limits` / `usage` (M)
13. `knowledge tree|read` (M)
14. `board list` + card actions (L)
15. `automations create --loop` (M)

## 2. Proposed build batches (disjoint files, can run in parallel)

All batches share two registration points: `dobius/src/cli/specs/index.ts` (spec list) and `dobius/src/main/runtime/rpc/methods/index.ts` (`ALL_RPC_METHODS`). Each batch adds one import line to each. To keep files disjoint, the orchestrator does those two one-line edits at merge time (or batch E owns them and the others leave a note). Same for the agent-key risk table if `wb/runtime-key-guard` lands first.

**Batch A: crew and agents** (gaps 1-5, 20, 34)
- New: `cli/specs/crew.ts`, `cli/handlers/crew.ts` (+ test), `main/runtime/rpc/methods/crew.ts` (+ test).
- Touch: `cli/specs/custom-agents.ts`, `cli/handlers/custom-agents.ts` (add `agents outbox`), new `cli/specs/teams.ts` + `cli/handlers/teams.ts`.
- Read-only dependency: `main/ipc/agents.ts` (move the shared functions behind the IPC handlers into a module both IPC and RPC call; if that means editing `main/ipc/agents.ts`, only this batch touches it).

**Batch B: git and PRs** (gaps 6-8, 23, 24)
- New: `cli/specs/git.ts`, `cli/handlers/git.ts` (+ test), `cli/specs/pr.ts`, `cli/handlers/pr.ts` (+ test), `cli/git-format.ts`.
- No RPC changes (all methods exist in `git.ts`, `github.ts`, `hosted-review.ts`).

**Batch C: workspace, tasks, tabs, terminal extras** (gaps 9, 10, 18, 19, 31, 32, 33, 36)
- Touch: `cli/specs/core.ts` (worktree sleep/wake, terminal agent), `cli/handlers/worktree.ts`, `cli/handlers/terminal.ts`, `cli/specs/tasks.ts`, `cli/handlers/tasks.ts`, `cli/specs/file.ts`, `cli/handlers/file.ts`, `main/runtime/rpc/methods/tasks.ts` (+ test).
- New: `cli/specs/tabs.ts`, `cli/handlers/tabs.ts`, `cli/specs/system.ts`, `cli/handlers/system.ts` (ports, skills, system, preflight).
- Conflict note: `cli/specs/core.ts` and `cli/selectors.ts` are also touched by `wb/board-cli-2`. Start this batch after that branch merges.

**Batch D: ADAM, usage, knowledge, app services** (gaps 11-13, 16, 17, 21, 22, 25-30)
- New: `cli/specs/adam.ts`, `cli/handlers/adam.ts`, `main/runtime/rpc/methods/adam.ts`; `cli/specs/app-services.ts`, `cli/handlers/app-services.ts`, `main/runtime/rpc/methods/app-services.ts` (usage, limits, knowledge, backup, version/update, feedback, iMessage, Telegram replies); `cli/specs/settings.ts`, `cli/handlers/settings.ts`, `cli/specs/accounts.ts`, `cli/handlers/accounts.ts`.
- Read-only dependency: `main/jarvis/*`, `main/ipc/rate-limits.ts`, `claude-usage.ts`, `knowledge.ts`, `cloud-backup.ts`, `updater` handler, `feedback.ts`, `imessage-bridge.ts`, `telegram-account.ts`. Shared logic is extracted next to each, one file per service, owned by this batch.
- Depends on `wb/adam-thread` (touches `jarvis:askAdamText`). Could be split into D1 (ADAM) and D2 (app services) if it runs long.

**Batch E: Board cards and loops** (gaps 14, 15, 38, 39)
- Touch: `cli/specs/board.ts`, `cli/handlers/board.ts`, `main/runtime/rpc/methods/board-consoles.ts` or new `board-cards.ts`, the renderer listener that answers board requests (same path `board.spawnConsole` uses), `cli/specs/automations.ts`, `cli/handlers/automations.ts`, `main/runtime/rpc/methods/automations.ts`.
- Must start after `wb/board-cli-2`, `wb/adam-thread` (both touch `cli/handlers/board.ts`) and `wb/snooze-tabs` merge. Largest batch (L).

**Last step (after A-E): SKILL.md + coverage test**
- Update `dobius/skills/dobius-cli/SKILL.md` (it already exists, 307 lines) and the agent-key risk table.
- Add one test that walks every `CommandSpec` and fails if a command lacks a risk class or `--json`, so new commands cannot skip the gate (CLI-Anything's "every command has JSON" rule, enforced).

## 3. SKILL.md outline

Extend the existing `dobius/skills/dobius-cli/SKILL.md` rather than add a second skill (one place for agents to look). If it grows past about 400 lines, keep a short index in SKILL.md and move each group to `references/<group>.md`.

1. **Frontmatter**: name, a description that lists the trigger words for every group (crew, git, PR, Kanban, Board, ADAM, usage, backup...).
2. **Start here**: `dobius status --json`, `dobius --help`, `dobius <group> --help`. Always pass `--json`; parse `result`, check `ok` and `error.code`.
3. **Addresses**: how to name things (worktree selectors `active`, `branch:`, `path:`; terminal handles; `card:<id-or-title>`; `tab:<tabId>`; `board:<orchestratorId>`). Handles change on restart; card ids and tab ids do not.
4. **What you may and may not do**: the risk classes (R, M, H, D), what the scoped agent key allows, and the human-only list (merge, Asana close, discard, secrets, approvals). What to tell Carson when refused.
5. **Recipes** (one short block each): run a task end to end (Kanban claim, worktree create, spawn console, wait, review, complete); morning check (briefing, decisions, drafts, limits, backup status); pause everything; ship a branch (git status, commit, push to fork, PR create, checks); hand off to another agent; drive a web tile; put a workspace to sleep.
6. **Command reference by group**: terminals, tabs, panes; worktrees and repos; Board; Kanban; crew and agents; automations and loops; orchestration; browser; computer use; git and PRs; ADAM and voice; usage and limits; knowledge and files; Telegram and iMessage; settings; app (status, version, backup, feedback). One line per command with its key flags.
7. **Errors and retries**: common error codes (`board_card_not_found`, `board_card_pane_unclear`, `worker_cap_reached`, runtime not reachable), and when to retry versus stop and ask.
8. **Testing your commands**: how the coverage test works, and running the CLI against an isolated test copy, never the live app.

## Could not determine

- Gmail / multi-inbox intake: no channel by that name in IPC or RPC. It may live under a different name or not be built yet.
- `destinations:*` IPC: purpose not checked.
- Whether `ui.set` can switch the visible view (Board, Tasks, Settings). Needs a read of `PersistedUIState` before gap 17 is sized.
- Whether `worktree.list` already marks sleeping workspaces (gap 9 assumes it might).
- Communications RPC count (about 100) is estimated from quoted names.
- The feature-row totals are a grouping judgment. The raw counts (233 CLI commands, 578 core RPC methods, 766 IPC channels) are enumerated.
