# Dobius V2 — Canonical Bug List (1–123)

Date: 2026-09-23. Branch: `stabilize/iris-20260923`.

These **numbers are canonical**. Do not renumber them. Each row maps to its ID in the source reports:
- `#N` = original 18 bugs in `IRIS-REPORT-20260923.md` (Codex review, all confirmed)
- `A/B/C/D/E/F + N` = findings in `IRIS-REPORT-20260923-DEEP.md`
- `x-A` / `x-B` / `x-C` / `x-D` = items from that area's "Also flagged" list in the deep report
- `Iris` = found by Claude in the first Iris pass

Verified column:
- **Confirmed** = Claude re-read the code and confirmed it. The original 18 (#1–#18) were all confirmed in `IRIS-REPORT-20260923.md`.
- **Static** = found by reading code only; needs reproduction. It may be wrong: if the repository disproves it, mark it **Refuted** with evidence.

## 1. Safety and security (1–27)

| # | Report ID | Verified | Bug |
|---|---|---|---|
| 1 | F4 | Confirmed | "Pause crew" doesn't stop Kanban auto-dispatch or the Voice Conductor |
| 2 | D2 | Confirmed | Pause file unreadable → agents turn back ON (fails open) |
| 3 | A1 | Confirmed | Credential hard rail only matches `~/` paths; `/Users/bayou/...` and `$HOME/...` pass |
| 4 | A14 | Static | Cross-agent memory rail misses `$HOME/.dobius/agents/<other>` |
| 5 | #1 | Confirmed | Codex agent runs have no budget / turn / tool limits |
| 6 | #2 | Confirmed | Triage can start builds (incl. review-lane) with no lane/budget/concurrency check |
| 7 | #2 / Codex design gap | Confirmed | Every Claude run gets `mcp__dobius__*` (all Dobius tools, incl. build dispatch) |
| 8 | B7 | Static | `agent.run` over RPC/socket has no default budget/turn cap |
| 9 | A2 | Static | Voice Conductor's mandated `dobius-confirm` gate is stubbed to `exit 1` |
| 10 | F3 | Confirmed | Voice Conductor iMessage handle read from env `DOBIUS_IMESSAGE_HANDLE` (never set in packaged app) → confirmations disabled |
| 11 | #5 | Confirmed | Voice Conductor "yes" accepts any message, not bound to its question |
| 12 | #4 | Confirmed | iMessage text typed into the active terminal + Enter, no check of the foreground process |
| 13 | B5 | Static | iMessage poll error skips high-water update → commands re-typed every 2 s |
| 14 | B14 | Static | iMessage `chat.guid LIKE %handle%` can match other chats |
| 15 | B12 | Static | `imessage-bridge.json` saved 0644 (world-readable) |
| 16 | B13 | Static | AppleScript quoting in imessage-send doesn't escape `\` |
| 17 | B1 | Confirmed | Phone WebSocket is plain `ws://` on 0.0.0.0:6768; handshake is replayable |
| 18 | B2 | Confirmed | Mobile-scope token can call terminal.send / git.push / worktree.rm / settings.update |
| 19 | B3 | Confirmed | Pairing QR tokens never expire and are hidden from the device list |
| 20 | B6 | Static | LAN client can fill all 128 WS slots (pre-auth DoS) |
| 21 | B4 | Static | `runtime:call` lets the renderer call any RPC method with a fake token |
| 22 | B8 | Static | Non-constant-time token comparisons (device, runtime, hook server) |
| 23 | #3 | Confirmed | Agent cwd creation failure silently falls back to the home folder (empty catch) |
| 24 | F2 | Confirmed | ElevenLabs API key stored unencrypted in dobius-data.json + all backups |
| 25 | D15 | Static | If safeStorage is unavailable, other secrets are saved as plaintext |
| 26 | C23 | Static | Jarvis self-edit forbidden-segment check runs before symlink resolution |
| 27 | x-C (`.env.local`) | Static | Jarvis self-edit only blocks `.env`; `.env.local`/`.env.production` writable |

## 2. Data loss / corruption (28–53)

| # | Report ID | Verified | Bug |
|---|---|---|---|
| 28 | #16 | Confirmed | Kanban read failure → empty board cached → next save wipes cards |
| 29 | D1 | Confirmed | agents-runs.json read failure → `[]` written back during load |
| 30 | D6 | Static | Same read-fail → empty → overwrite pattern in ~20 stores (agents.json, teams.json, asana-config.json, drafts, briefings, ledger, …) |
| 31 | D3 | Static | Any error in persistence migrate/normalize → primary overwritten by backup up to ~1 h old (non-atomic); defaults can rotate into all 5 backups |
| 32 | D10 | Static | One invalid workspaceSession field wipes all tabs/layouts |
| 33 | D13 | Static | Concurrent backup rotation at quit can lose a generation |
| 34 | D4 (keypair) | Static | Unreadable e2ee keypair → silent new keypair; phones break |
| 35 | D4 (devices) + B9 | Static | Unreadable device registry → empty → next save erases all pairings |
| 36 | D5 | Static | Communications identity replaced after any read error; non-atomic writes |
| 37 | D7 | Static | Half-written media blob treated as complete forever |
| 38 | #14 | Confirmed | Jarvis self-edit apply overwrites changes made after the proposal |
| 39 | C9 | Static | Jarvis "one-step undo" doesn't exist |
| 40 | C11 | Static | Saving an agent overwrites memory.md with a stale copy |
| 41 | C20 | Static | Editing the tagline during a run wipes the live transcript |
| 42 | #12 | Confirmed | Run history cap (50) evicts still-running runs |
| 43 | #11 | Confirmed | Asana task interrupted mid-triage stays "claimed" → skipped 30 days |
| 44 | x-A (dead-letter prune) | Static | Dead-lettered Asana tasks re-triaged after 30-day prune |
| 45 | x-A (no triage agent) | Static | No triage agent set → tasks marked briefed and skipped forever |
| 46 | x-A (briefing dismiss) | Static | Dismissing briefing wipes all history, not the 48 h window |
| 47 | C22 | Static | Deleting a child task leaves its id in the parent |
| 48 | D8 | Static | Terminal history never swept (229 dirs, 123 MB) |
| 49 | D11 | Static | Temp files left after failed writes (stats, agent-hooks) |
| 50 | D12 | Static | Daemon meta.json non-atomic → false cold restore |
| 51 | D14 | Static | Browser session registry shares one tmp filename + empty catch |
| 52 | x-D (V1 writer) | Static | Legacy V1 app still writes config.json/checkpoints in the same userData |
| 53 | x-D (two userData) | Static | Two notions of userData path (cached vs lazy) can split data |

## 3. Agents / orchestration / automation (54–81)

| # | Report ID | Verified | Bug |
|---|---|---|---|
| 54 | A3 | Confirmed | Review lane always empty (`completed_since=now` + drop incomplete) |
| 55 | #10 | Confirmed | Successful Codex runs never call onResult/free triage slot |
| 56 | #6 | Confirmed | Session-busy check before await → two runs resume one session |
| 57 | A6 | Confirmed | "Reset session" doesn't clear `sessionsByKey` |
| 58 | #7 | Confirmed | Voice Conductor runs overlap; stop misses earlier run |
| 59 | A7 | Static | Voice turns run as `channel` with hidden $1 cap |
| 60 | A8 | Static | Conductor prompt/tools/model changes never reach stored agent |
| 61 | A9 | Static | Conductor prompt claims concurrency cap 1; code has none |
| 62 | #8 | Confirmed | Orphaned `running` coordinator row after restart blocks orchestration |
| 63 | A4 | Static | Hung-worker check compares SQLite vs ISO timestamps → always hung |
| 64 | A5 | Static | Late escalation fails latest dispatch regardless of status |
| 65 | x-A (convergence) | Static | Coordinator convergence reads global task table |
| 66 | A13 | Static | Hourly heartbeat missed if tick isn't exactly :00 |
| 67 | x-A (Codex heartbeat) | Static | Codex heartbeats ignore cheap model / never route a verdict |
| 68 | A10 | Static | Automation completion race → duplicate notifications |
| 69 | A11 | Static | Automation stuck `dispatching` after quit |
| 70 | A12 | Static | Bare `codex` spawn; ENOENT → unhandled stdin error in main |
| 71 | #17 | Confirmed | Background promises with no catch (automations, coordinator) |
| 72 | x-A (pagination) | Static | Asana fetch capped at 50, no pagination |
| 73 | x-A (`tools: []`) | Static | `tools: allowedTools` misuse can yield no tools |
| 74 | x-A (canUseTool) | Static | Non-manual runs have no canUseTool → permissions silently denied |
| 75 | x-A (bypass button) | Static | "Bypass for this run" may throw (SDK flag) |
| 76 | A16 | Static | `git push … && rm -rf dist` wrongly denied as force-push |
| 77 | A15 | Static | Per-run outbox never trimmed (screenshots ~1 MB each) |
| 78 | #13 | Confirmed | Journal write + ADAM forward share one chain; replay stops at first error |
| 79 | E9 | Static | No ADAM token → events silently never sent |
| 80 | E10 | Static | ADAM down → events dropped until next launch |
| 81 | E8 | Static | Two separate ADAM configs (journal vs Jarvis) |

## 4. Voice and screens (82–99)

| # | Report ID | Verified | Bug |
|---|---|---|---|
| 82 | C1 | Confirmed (static trace) | Jarvis turn torn down on every re-render (unstable `useAudioCapture` object) |
| 83 | C6 | Static | Double ⌘T while connecting → live paid ElevenLabs call, orb idle |
| 84 | C7 | Static | OpenAI transcription has no timeout → stuck "Processing…" |
| 85 | C8 | Static | Cloud dictation silently drops audio after 10 min |
| 86 | C16 | Static | STT worker error leaves orphaned model thread |
| 87 | C10 | Static | Failed CLI --help cached → Jarvis refuses all commands |
| 88 | C13 | Static | No STT model → generic "Voice error" |
| 89 | C14 | Static | ⌘T lost when the self-edit window is focused |
| 90 | C17 | Static | Jarvis TTS temp dirs never deleted |
| 91 | C18 | Static | TTS chunk failure → local voice re-reads whole reply |
| 92 | C21 | Static | Settings change mid-hold cancels dictation |
| 93 | C4 | Confirmed | Kanban → Done uses `window.prompt` (unsupported) → card snaps back |
| 94 | C5 | Static | Kanban card stuck "Agent is working" after crash; can't re-dispatch |
| 95 | C19 | Static | Kanban "Completion rate NaN%" on empty board |
| 96 | C12 | Static | Automations Run Now / Pause / Delete fail silently |
| 97 | C24 | Static | Any settings change reloads all automations + worktrees |
| 98 | C15 | Static | Agent "Live" panel shows stale summaries as current |
| 99 | x-C (crew count) | Static | Crew "running" counts runs, not agents |

## 5. Build / install / updates (100–118)

| # | Report ID | Verified | Bug |
|---|---|---|---|
| 100 | #9 | Confirmed | build-and-install.sh → install-dobius-v2.sh does `rm -rf` app before copy |
| 101 | E3 | Static | build-and-install.sh skips build:cli/relay/web/native → ADAM rejects bundle |
| 102 | E6 | Confirmed | Downgrade guard ignores `-rc` (2.0.0-rc.1 ≥ 2.0.0); happened 09-19 07:56 |
| 103 | E5 | Static | install-dobius-v2.sh writes no provenance/lock/downgrade guard |
| 104 | #18 | Confirmed | Gated installer checks before lock; rm/mv window with no app |
| 105 | E7 | Static | Gated install leaves a duplicate same-bundle-ID app in dobius/dist |
| 106 | E1 | Confirmed | Background update checks bypass disconnect switch → dead Download button |
| 107 | E12 (+F7) | Static | "Check for Updates" always says up to date |
| 108 | E2 | Static | RELEASING.md wrong for V2 (package.json, notarization, names, interval) |
| 109 | E15 (versions) | Confirmed | Root 1.0.29 vs app 2.0.0; installed "2.0.0" is rc.1 + dirty tree |
| 110 | E15 (tags) | Static | No v2 git tag |
| 111 | E14 | Static | dev-app-update.yml points at wrong repo; unused |
| 112 | E16 | Static | Install-gate hook bypassable via scripts |
| 113 | E17 | Static | dobius-build-install skill advertises the disabled installer |
| 114 | E19 | Confirmed | Repo wants Node 24; machine has Node 22 |
| 115 | E lint | Confirmed | Lint fails with 3,625 errors (mostly components/communications) → blocks commits there |
| 116 | E4 | Confirmed | CLAUDE.md + .claude/CLAUDE.md describe V1 app, wrong path, unsafe install |
| 117 | E18 | Confirmed | Notes claim `ensureLearnHooks()` exists; it doesn't |
| 118 | E13 | Static | `~/dobius/projects/ADAM` hardcoded in 3 places |

## 6. Settings that lie or do nothing (119–123)

| # | Report ID | Verified | Bug |
|---|---|---|---|
| 119 | F1 | Confirmed | Asana Auto Mode can be enabled but never runs while paused; pane doesn't say |
| 120 | F5 | Static | Asana `allowedProjects` read nowhere |
| 121 | F6 (+E11) | Static | Lane GIDs in Settings ignored by Voice Conductor (hardcoded) |
| 122 | F8 + F11 + F9 | Static | "Markdown Review Notes" and "Share usage data" do nothing; Jarvis switch silently turns itself off |
| 123 | F10 | Static | Dictation server IP hardcoded; `vpsSttEndpoint` setting never used |

---

## Not in the numbered list

### By design (Carson, 2026-09-23). Do NOT fix.
- **C2**: Jarvis voice agent may apply its own proposed code edits.
- **C3**: Jarvis `run_dobius` may send input + Enter to terminals.
- Only allowed follow-up: the self-edit window footer text ("Nothing is written until you do") may be reworded to match. No behavior change.

### Open decision for Carson
- **iMessage → terminal (#12)**: assume the feature **stays**. Plan a guard (e.g. only type into a terminal whose foreground process is an agent, or require an explicit prefix + confirmation). Do not remove the feature.

### Extra findings not numbered (include in the plan as X-items; don't drop them)
- X1 — **#15** Jarvis self-edit root: packaged app resolves to the bundle `Contents` dir; in dev it's likely the whole `~/Projects (Code)/Dobius` folder (Iris finding 6).
- X2 — Install provenance stamps HEAD and never records a dirty tree (Iris finding 4).
- X3 — Stale comment `voice-conductor/service.ts:42` says spawn "fails loudly" (Iris finding 5).
- X4 — Agent edit form says bypass is "unchanged in Phase 1", but it's live (x-C).
- X5 — `dobius-ask` usage says "Ask Sam" but texts Carson (x-A).
- X6 — Command Center "Generate" button isn't wired to any pipeline (x-C).
- X7 — Legacy `OrbView` still mounts a second capture pipeline (x-C).
- X8 — `tls-certificate.ts` dead code; two CLI installers own the same script names; dead `orb:close` handler; pairing QR accepts any host address (x-B).
- X9 — Orphan settings `showTasksButton`, `voice.voiceEngine`, `voice.localTtsEngine`; stale `workspaceDirHistory` path; `DOBIUS_CLAUDE_CLI_PATH` env overrides the Settings override (F12–F14).
- X10 — Synchronous large writes on the main thread (claude-usage 5.1 MB, stats 1.5 MB, 340 KB per pty spawn) (D9 + x-D).
- X11 — Relay DB and event archive have no retention (x-D).
- X12 — The architecture gap from `Dobius Agentic Gap Analysis 2026-09-23` (Obsidian): Dobius agent runs don't pass ADAM's context-handshake gate. Not a numbered bug, but it's the natural home for the Phase 1 "global execution control" foundation.
