# Deep Bug Hunt: Dobius+ (full sweep) — 2026-09-23

Follow-up to `IRIS-REPORT-20260923.md`, which holds the 18 original bugs, numbered #1–#18.

Method: six parallel read-only investigations, one per area:
- **A** agent engine
- **B** ways in and security
- **C** voice and Dobius screens
- **D** saved data
- **E** build and plumbing
- **F** every setting

Each finding cites `file:line`.

✅ means Claude re-read the code and confirmed the finding. Everything else is an agent's finding from reading code; nothing was run. Paths are relative to `dobius/src/` unless noted.

**Totals:** 18 original + 107 new findings = 125 (A 16, B 14, C 24, D 15, E 19, F 14, plus 5 found by Claude during the first Iris pass).

---

## The headline

Dobius is **half-paused**, and several safety promises in the UI aren't enforced.

- **Paused** (`agentsPaused: true`): heartbeats and Asana Auto Mode. Auto Mode is also switched off separately.
- **Still running:**
  - Kanban board auto-dispatch (`vertexAutoModeEnabled: true`) ✅
  - Voice Conductor (`conductorEnabled: true`, Opus, bypassPermissions) ✅
  - Jarvis (`jarvisEnabled: true`) ✅
  - iMessage → terminal ✅
- "Pause crew" only pauses 2 of the 4 background systems (F4 ✅).

---

## Fix first: top 13

| # | ID | Problem | Why it's first |
|---|---|---|---|
| 1 | F4 ✅ | "Pause crew" doesn't pause Kanban auto-dispatch (`renderer/src/components/kanban/board-dispatch.ts` has no pause check; `App.tsx:493`) | Paid agent runs can start while you believe everything is off |
| 2 | D2 ✅ | The pause switch fails **open**: an unreadable `agents-config.json` → `agentsPaused: false` (`main/agents/agents-config-store.ts:63-74`, default `:21`) | One bad byte turns every agent back on |
| 3 | A1 ✅ | The credential "hard rail" only blocks `~/` paths; `cat /Users/bayou/.claude/.credentials.json` or `$HOME/...` passes (`main/agents/agent-hard-rails.ts:73-79,104-119`) | Bypass-mode agents can read your Claude login |
| 4 | #4 ✅ | iMessage text is typed into the active terminal plus Enter, with no check of what's running (`main/imessage-bridge/bridge-service.ts:252`) | Live today |
| 5 | B2 ✅ | A phone ("mobile") token may call `terminal.send`, `git.push`, `worktree.rm`, `settings.update` (`main/runtime/runtime-rpc.ts:120-356,957`) | A leaked QR token = shell on your Mac |
| 6 | B1 ✅ | The phone WebSocket is plain `ws://` on `0.0.0.0:6768`; the handshake has no freshness check, so a sniffed session can be replayed (`runtime-rpc.ts:701-705`, `rpc/e2ee-channel.ts:170-181`) | Anyone on the same Wi-Fi (exploit inferred, code confirmed) |
| 7 | B3 ✅ | Pairing QR tokens never expire and are hidden from the device list (`main/runtime/device-registry.ts:52-58`, `ipc/mobile.ts:154`) | Old screenshots stay valid logins |
| 8 | #1 ✅ | Codex agent runs have no budget, turn cap or tool limit (`main/agents/codex-agent-execution.ts:76`) | Edith and Watson are Codex |
| 9 | #9 ✅ + E3 | `build-and-install.sh` does `rm -rf` on the app, then copies, and skips the CLI/relay builds ADAM needs | Can leave you with no app, or an app ADAM refuses |
| 10 | E6 ✅ | The downgrade guard ignores `-rc`: `2.0.0-rc.1` ≥ `2.0.0` (`scripts/install-dobius-gated.sh:48-51`) | A hostinger test lane was installed over the app on 09-19 07:56 |
| 11 | D1 ✅ | `agents-runs.json` read failure → writes `[]` back **during load** (`main/agents/agent-runs-store.ts:88-95`) | Wipes run history with no user action |
| 12 | D6 | The "fail to read → empty → next save overwrites" bug appears in ~20 stores, incl. `agents.json`, `teams.json`, `asana-config.json` | Same class as the Kanban wipe (#16) |
| 13 | C1 ✅ | The Jarvis turn tears itself down on every re-render: `useAudioCapture()` returns a new object → `stopSessionCleanly` changes → cleanup effect fires (`renderer/.../jarvis/use-jarvis-turn.ts:51,96-119,305-318`) | Likely why ⌘T Jarvis feels broken (static analysis, not run) |

---

## A — Agent engine (16)

| ID | Sev | Where | Problem |
|---|---|---|---|
| A1 ✅ | high | main/agents/agent-hard-rails.ts:73 | The credential rail only matches `~/` paths |
| A2 | high | voice-conductor/conductor-system-prompt.ts:61; dobius-cli/install-clis.ts:12 | The conductor's mandatory `dobius-confirm` gate is stubbed to `exit 1`; with bypass on, the model decides whether to proceed |
| A3 ✅ | high | main/asana/asana-client.ts:124-137 | Review lane always empty: `completed_since=now` returns only incomplete tasks, then incomplete tasks are dropped |
| A4 | med | runtime/orchestration/coordinator.ts:233 | Hung-worker check compares SQLite `YYYY-MM-DD HH:MM:SS` against ISO `...T...Z`, so it's always "hung" |
| A5 | med | orchestration/coordinator.ts:309 | A late escalation fails the latest dispatch regardless of status; 3 stray ones circuit-break a healthy task |
| A6 ✅ | med | main/agents/agents-store.ts:333 | "Reset session" clears only `lastSessionId`, not `sessionsByKey`, so the next run resumes the old session |
| A7 | med | voice-conductor/conductor.ts:139; agent-runner.ts:365 | Voice turns run as `channel` with a hidden $1 cap; big requests die silently |
| A8 | med | voice-conductor/conductor.ts:89-108 | The conductor agent is created once; prompt, tools and model changes in code never reach the stored agent |
| A9 | med | conductor-system-prompt.ts:112 vs work-registry.ts:6 | The prompt says concurrency is capped at 1; the code has no cap |
| A10 | med | automations/service.ts:136-164 | Race: duplicate automation notifications and overwritten usage |
| A11 | med | automations/service.ts:234 | A run left `dispatching` forever after a quit mid-dispatch |
| A12 | med | agents/codex-agent-execution.ts:87 | Spawns bare `codex`; if it isn't on PATH, a stdin write → unhandled error in the main process |
| A13 | med | agents/agent-heartbeat-service.ts:66 | Hourly heartbeat needs the tick to land exactly at :00; missed hours never catch up |
| A14 | med | agents/agent-hard-rails.ts:137 | Cross-agent memory rail misses `$HOME/.dobius/agents/<other>` |
| A15 | low | agents/agent-runs-store.ts:138 | Per-run outbox (screenshots ~1 MB each) never trimmed |
| A16 | low | agents/agent-hard-rails.ts:57 | `git push … && rm -rf dist` wrongly denied as a force-push |

Also flagged:
- With no triage agent set, tasks are marked briefed and skipped forever.
- Dead-lettered tasks retry after 30 days.
- The Asana fetch has no pagination (50 max).
- `tools: allowedTools` misuse can yield `tools: []`.
- Non-manual runs have no `canUseTool`, so permission prompts are silently denied.
- "Bypass for this run" may throw (SDK flag missing).
- Dismissing the briefing wipes all history.
- `dobius-ask` help says "Ask Sam" but texts Carson.
- Coordinator convergence reads the global task table.

## B — Ways in and security (14)

| ID | Sev | Where | Problem |
|---|---|---|---|
| B1 ✅ | high | runtime/runtime-rpc.ts:701; rpc/e2ee-channel.ts:153-216 | Plain ws on 0.0.0.0; replayable handshake |
| B2 ✅ | high | runtime/runtime-rpc.ts:120-356 | Mobile scope allows shell, push and delete |
| B3 ✅ | med | runtime/device-registry.ts:52 | Pairing tokens never expire, hidden from the list |
| B4 | med | ipc/runtime.ts:33-45 | `runtime:call` lets the renderer call any RPC method with a fake token; one XSS = shell |
| B5 | med | imessage-bridge/bridge-service.ts:198-216 | A throw mid-poll skips the high-water update, so `d:` commands are re-typed every 2 s |
| B6 | med | rpc/ws-transport.ts:188 | Anyone on the LAN can take all 128 connection slots, locking the phone out |
| B7 | med | rpc/methods/custom-agents.ts:140 | `agent.run` over the socket has no default budget or turn cap |
| B8 | low | device-registry.ts:90; runtime-rpc.ts:903; agent-hooks/server.ts:1187 | Non-constant-time token compares |
| B9 | low | device-registry.ts:115 | Corrupt device file → empty → next save erases all pairings |
| B10 | low | runtime-rpc.ts:1072 | Orphan socket sweep misses reused pids (a Sep 13 socket still present) |
| B11 | low | dobius-cli/dispatch-server.ts:140,206 | `/tabSend` has no timeout; `/tabRead` limit unvalidated |
| B12 | low | imessage-bridge/bridge-config.ts:76 | `imessage-bridge.json` is 0644 (holds your phone/email) |
| B13 | low | imessage-bridge/imessage-send.ts:55 | AppleScript quoting doesn't escape `\` |
| B14 | low | bridge-service.ts:39,193 | `chat.guid LIKE %handle%` can match other chats |

Also flagged:
- `tls-certificate.ts` is dead code.
- Two CLI installers own the same script names.
- `terminal.send`'s "agent must be running" guard is opt-in and never used by iMessage or CLI.
- The pairing QR accepts any host address from the renderer.
- There's a dead `orb:close` handler.

## C — Voice and Dobius screens (24)

| ID | Sev | Where | Problem |
|---|---|---|---|
| C1 ✅ | critical | renderer jarvis/use-jarvis-turn.ts:51,96,305 | Session torn down on every re-render |
| C2 ✅ | by design | renderer jarvis/use-voice-agent.ts:115 | The AI can self-approve code edits |
| C3 ✅ | by design | main/jarvis/agent-context.ts:35 | Voice → `terminal send --enter` allowed |
| C4 ✅ | high | kanban/KanbanBoard.tsx:589 | Moving a card to Done calls `window.prompt` (unsupported in Electron); the card snaps back |
| C5 | high | kanban/board-dispatch.ts:81-122 | A crash mid-run leaves the card "Agent is working" forever, and it can't be re-dispatched |
| C6 | high | jarvis/use-voice-agent.ts:49-170 | Double ⌘T while connecting → live paid ElevenLabs call, mic open, orb says idle |
| C7 | high | main/speech/openai-transcription-client.ts:81 | No timeout: dictation stuck on "Processing…", ⌘E ignored |
| C8 | med | speech/*-transcription-client.ts; hooks/use-audio-capture.ts:179 | After 10 min, cloud dictation silently drops audio while showing "Listening" |
| C9 | med | main/jarvis/self-edit.ts:22 | The promised one-step undo doesn't exist |
| C10 | med | main/jarvis/agent-context.ts:15,77 | One failed CLI help call caches "no commands" until restart |
| C11 | med | agents/AgentsPage.tsx:141-153 | Saving an agent overwrites `memory.md` with the stale copy |
| C12 | med | automations/AutomationsPage.tsx | Run Now, Pause and Delete fail silently |
| C13 | med | jarvis/use-jarvis-turn.ts:194 | No STT model → generic "Voice error" |
| C14 | med | main/jarvis/jarvis-ipc.ts:36 | ⌘T lost when the self-edit window is focused |
| C15 | med | agents/AgentLivePulse.tsx:45 | "Live" panel shows days-old summaries as current |
| C16 | med | main/speech/stt-service.ts:245 | STT worker error leaves the orphaned model thread in memory |
| C17 | low | main/jarvis/elevenlabs-client.ts:75 | TTS temp folders are never deleted |
| C18 | low | elevenlabs-client.ts:80 | Chunk failure → the local voice re-reads the whole reply |
| C19 | low | kanban/KanbanBoard.tsx:435 | "Completion rate NaN%" on an empty board |
| C20 | low | agents/AgentsPage.tsx:134 | Editing the tagline during a run wipes the transcript |
| C21 | low | dictation/use-hold-dictation-gesture.ts:160 | A settings change mid-hold cancels dictation |
| C22 | low | main/vertex/vertex-task-store.ts:295 | Deleting a child task leaves a dangling id in the parent |
| C23 | low | main/jarvis/self-edit.ts:80 | Forbidden-folder check runs before symlink resolution |
| C24 | low | automations/AutomationsPage.tsx:1008 | Any settings change reloads all worktrees and automations |

Also flagged:
- The agent form says bypass is "unchanged in Phase 1", but it's live.
- `.env.local` is writable by Jarvis (only `.env` is blocked).
- The Command Center "Generate" button isn't connected to anything.
- The "Crew running" count counts runs, not agents.
- The legacy `OrbView` still mounts a second capture pipeline.

## D — Saved data (15)

| ID | Sev | Where | Problem |
|---|---|---|---|
| D1 ✅ | high | agents/agent-runs-store.ts:88 | Load failure writes `[]` immediately |
| D2 ✅ | high | agents/agents-config-store.ts:63 | The pause switch fails open |
| D3 | high | persistence.ts:2786,3357 | Any error in the 530-line migrate block → the main file is overwritten by a backup up to ~1 h old (non-atomic); if the backup also fails, defaults can rotate into all 5 backups |
| D4 | high | runtime/e2ee-keypair.ts:45; device-registry.ts:115 | Unreadable key → silent new keypair (phone breaks); unreadable device list → pairings erased |
| D5 | med | communications/participant-identity-store.ts:107-150 | Any read error → Communications identity replaced; writes are non-atomic |
| D6 | med | ~20 stores (agents.json, teams.json, asana-config.json, drafts, briefings, ledger…) | Read failure → empty → next save overwrites |
| D7 | med | communications/workstation/media/blob-store.ts:139 | Half-written media file is treated as complete forever |
| D8 | med | daemon/history-manager.ts:302 | Terminal history never swept: 229 folders, 123 MB since 24 Aug |
| D9 | med | claude-usage/store.ts:365; stats/collector.ts:264 | 5.1 MB + 1.5 MB synchronous writes on the main thread (UI stalls); "left for debugging" comment is false |
| D10 | low | persistence.ts:3311 | One bad field wipes all tabs and layouts |
| D11 | low | stats/collector.ts:264 | Temp files left after failed writes (0-byte residue on disk proves it) |
| D12 | low | daemon/history-manager.ts:85 | Non-atomic meta → false cold restore |
| D13 | low | persistence.ts:3644 | Concurrent backup rotation at quit can lose a generation |
| D14 | low | browser/browser-session-registry.ts:80 | Shared tmp filename plus an empty catch |
| D15 | low | persistence.ts:224 | If encryption is unavailable, secrets are saved in plain text |

Also flagged:
- The **old V1 app still writes the same data folder** (`config.json`, `checkpoints/`).
- Two notions of the userData path.
- A synchronous 340 KB write on every terminal spawn.
- Relay DB has no retention (13 MB).

## E — Build, updater, plumbing (19)

| ID | Sev | Where | Problem |
|---|---|---|---|
| E1 | high | main/updater.ts:1340,1353,703 | Startup, wake and 24 h update checks bypass the disconnect switch → "update available" with a dead Download button |
| E2 | high | RELEASING.md | Wrong package.json (root 1.0.29), unnotarized publish command, wrong file names and intervals |
| E3 | high | build-and-install.sh:30 | Skips `build:cli`/`relay`/`web`/`native` after wiping `out/` → ADAM refuses the bundle |
| E4 | high | CLAUDE.md:8-94 | Points agents at `~/Projects (Code)/dobius-plus` (test lanes) and the unsafe install |
| E5 | med | scripts/install-dobius-v2.sh | No provenance/lock/downgrade guard → disables the gated ownership check afterwards |
| E6 ✅ | med | scripts/install-dobius-gated.sh:48 | `-rc` versions pass the downgrade guard |
| E7 | med | install-dobius-gated.sh | Leaves a second `Dobius+.app` (same bundle ID) in `dobius/dist/` → duplicate Dock icon risk |
| E8 | med | agent-run-event-journal.ts:44 vs jarvis/adam-client.ts:22 | Two separate ADAM configs |
| E9 | med | agent-run-event-journal.ts:88 | No token → events silently never sent |
| E10 | med | agent-run-event-journal.ts:110 | ADAM down → events dropped until next launch |
| E11 | med | voice-conductor/service.ts:27 | Hardcoded Asana GIDs duplicate the Settings values |
| E12 | med | updater.ts:1040 | "Check for updates" says "up to date" when updates are disabled |
| E13 | low | jarvis/adam-client.ts:12 etc. | `~/dobius/projects/ADAM` hardcoded 3× |
| E14 | low | config/dev-app-update.yml | Points at the wrong repo; unused |
| E15 ✅ | low | versions | Root 1.0.29 vs app 2.0.0; no v2 git tag; the installed "2.0.0" came from an rc.1 commit plus uncommitted work |
| E16 | low | ~/.claude/hooks/dobius-install-gate.sh | Only catches commands containing the literal app path, so the scripts bypass it |
| E17 | low | ~/.claude/skills/dobius-build-install/SKILL.md:3 | Description advertises the disabled installer |
| E18 | low | ~/.claude/settings.json rewrite | Safe (keeps your hooks), **but `ensureLearnHooks()` doesn't exist**; `SKILLS-HOOKS-AGENTS.md` is wrong |
| E19 | low | Node | Repo wants Node 24; this Mac has 22 |

Checks: typecheck **passes**; lint **fails with 3,625 errors** (almost all in `components/communications/`), so commits touching those files are blocked by pre-commit.
Repo: 12 worktrees, 79 branches (42 unmerged), `fix/channel-cost` has no upstream, 183 ahead / 296 behind `fork/main`.

## F — Every setting (14)

146 of 170 settings are wired and work. The problems:

| ID | Sev | Setting | Problem |
|---|---|---|---|
| F1 | high | Asana "Auto Mode" | Can be switched on but never runs while agents are paused; the pane never says so |
| F2 | high | ElevenLabs API key | Stored **unencrypted** in `dobius-data.json` + 5 backups (+ manual backups) |
| F3 ✅ | high | Voice Conductor iMessage confirms | Uses env `DOBIUS_IMESSAGE_HANDLE` (`index.ts:1925`), which the installed app never has → confirmations disabled |
| F4 ✅ | high | "Pause crew" | Doesn't pause Kanban auto-dispatch or the Voice Conductor |
| F5 | med | Asana `allowedProjects` (5 projects) | Read nowhere; filters nothing |
| F6 | med | Build/Review lane GIDs | The Voice Conductor ignores them (hardcoded) |
| F7 | med | "Check for Updates" | Always says up to date |
| F8 | med | "Markdown Review Notes" | Does nothing |
| F9 | med | Jarvis switch | Turns itself off silently if another app holds ⌘T |
| F10 | med | Dictation server | Hardcoded Tailscale IP `100.98.24.1:8823`; the setting exists but is never used |
| F11 | low | "Share anonymous usage data" | No-op (telemetry disabled); the label is false |
| F12 | low | `showTasksButton`, `voice.voiceEngine`, `voice.localTtsEngine` | Orphans from an old build |
| F13 | low | workspace history | Points at the deleted `~/orca/workspaces` |
| F14 | low | `DOBIUS_CLAUDE_CLI_PATH` env | Silently overrides the Settings override |

Also: every coding agent launches with its "skip permissions" flag by default (`agentDefaultArgs`). That's by design, but worth knowing.
Not covered: label-vs-behavior checks for the General, Appearance, Terminal, Git, Integrations, Agents, CLI, Mobile, SSH and Advanced panes. Those panes only got the "is this setting read anywhere" check.

---

## Corrections to earlier notes

- **C2 and C3 are by design (Carson, 2026-09-23).** Jarvis is meant to be able to apply its own proposed edits and send input to terminals by voice. Removed from the fix list. Only open item: the review window's footer text ("Nothing is written until you do") doesn't match that behavior.

- The Voice Conductor is **on** in live settings (it's off by default).
- `ensureLearnHooks()` in `~/.claude/SKILLS-HOOKS-AGENTS.md` doesn't exist.
- `CLAUDE.md` and `dobius/AGENTS.md` point at the wrong repo path.
- The installed app is an rc.1 commit plus uncommitted changes, not a clean 2.0.0.

## Suggested fix order

1. **Stop the bleeding:**
   - F4 (pause everything)
   - D2 (pause fails closed)
   - A1/A14 (credential rails)
   - #4 (iMessage)
   - B2/B3 (mobile scope + token expiry)
   - F2 (encrypt the ElevenLabs key)
2. **Safe installs:** #9/E3/E5/E6/#18: one gated build-and-install that builds everything and checks rc versions. This is also where the auto version bump goes.
3. **Data safety:** D1, D3, D4, D6 (one shared "safe JSON store" helper fixes about 20 files at once), #16.
4. **Before un-pausing agents:** #1, #2, #6, #10, #11, A3, A6, A7, A8, A2.
5. **Voice quality:** C1, C6, C7, C8, C4, C5.
6. **Docs and settings truth:** E2, E4, F1, F7, F8, F11, E18.
