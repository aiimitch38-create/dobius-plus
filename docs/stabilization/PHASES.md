# Dobius+ V2 — Stabilization phases

Date: 2026-09-24. Phases are ordered by engineering dependency and risk. Each task is one build from `EXECUTION-ORDER.md`, which holds the full file lists and rollback notes; this file adds the why, the change, and the risk. Path prefixes: `M/` = `dobius/src/main/`, `R/` = `dobius/src/renderer/src/`, `S/` = `dobius/src/shared/`.

Changes from the suggested outline, and why:
- **Installer safety stays in Phase 8**, but Gate A carries a procedural rule (gated installer only, one lane) because every phase has to be installed to be tested. Moving the installer earlier would put release tooling ahead of remote control, secrets and data loss in the priority list.
- **The phone listener off switch (N10) moves into Phase 1.** Remote control is priority 1, and a switch is far smaller than the protocol work in Phase 5. With the listener off, Phase 5 can wait for its dependencies.
- **Conductor approvals (#9–#11) sit in Phase 5, not Phase 6.** Their root cause is iMessage identity (#14), shared with the bridge.
- **Kanban reconciliation (#94) moves into Phase 3** with the run lifecycle; only its display bugs stay in Phase 7.

| Phase | Goal | Bug IDs | Depends on | Risk |
|---|---|---|---|---|
| 0 | Freeze and baseline | — (records #114, #115 facts) | — | Low |
| 1 | Safety foundation | 1, 2, 3, 4, 6, 7, 8, 23, 26, 27, 73, 74, 75, 76, 119 + N1, N3, N10, N13, X1, X4 | 0 | Medium |
| 2 | Data integrity | 15, 24, 25, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 46, 47, 48, 49, 50, 51, 52, 53 + N6 | 1 (001) | High |
| 3 | Agent runtime | 5, 42, 43, 44, 45, 55, 56, 57, 66, 67, 70, 77, 94 + N2, N9 | 1, 2 | Medium |
| 4 | Orchestration, automation, ADAM | 54, 62, 63, 64, 65, 68, 69, 71, 72, 78, 79, 80, 81, 118, 120 + N4, N5, X12 | 1, 3 | Medium |
| 5 | Remote, phone, iMessage | 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 121 + N11, N12, X3, X5, X8 | 1, 2 (016) | High |
| 6 | Voice | 58, 59, 60, 61, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 123 + X7, #122-F9 | 3, 5 | Medium |
| 7 | UI behavior | 93, 95, 96, 97, 98, 99 + X6 | 2, 3, 4 | Low |
| 8 | Build and release | 100, 101, 102, 103, 104, 105, 106, 107, 109, 110, 111, 112, 114 + N8, X2, version bump | 0 | Medium |
| 9 | Config and docs | 108, 113, 115, 116, 117, 122 + X9, WORKSPACE.md | 4, 8 | Low |
| 10 | Full regression | — | all | — |

Deferred with reasons (in `EXECUTION-ORDER.md`): N7, X10, X11.

---

## Phase 0 — Freeze and baseline

- **Goal:** know exactly what is installed and running, and hold a private copy of all data before any change.
- **Bug IDs:** none fixed. Records the facts behind #109, #114, #115.
- **Root cause addressed:** there is no reproducible starting point today (installed build is a dirty rc.1 tree; lint count has no saved report).
- **Tasks:** see `BASELINE.md` (source state, toolchain, installed provenance, tests, build without install, settings keys, snapshot to `~/Backups/dobius-stabilization-<date>/`).
- **Verification:** snapshot checksums verify; logs have real exit codes.
- **Exit criteria:** `BASELINE.md` §5.

## Phase 1 — Safety foundation

- **Goal:** one fail-closed switch stops every autonomous start; the phone listener can be turned off; agents cannot read credentials or escape their workspace; each run gets only the tools its source needs.
- **Bug IDs:** 1, 2, 3, 4, 6, 7, 8, 23, 26, 27, 73, 74, 75, 76, 119; N1, N3, N10, N13; X1, X4.
- **Root cause:** authority is granted by transport or tool availability, never checked at the point of execution. Pause is a producer-side boolean read by 2 of 15 producers (ARCHITECTURE-MAP §5.1). Path policy is regex over shell text (`M/agents/agent-hard-rails.ts:12-23,70-157`) and pre-realpath segment matching (`M/jarvis/self-edit.ts:80-90`). Every Claude run gets `mcp__dobius__*` (`M/agents/agent-runner.ts:348`, `agent-runner-dobius-tools.ts:4-8`).
- **Files:** `M/agents/agents-config-store.ts:59-128`; `M/agents/agent-runner.ts:257-436`; `M/agents/agent-tools/dobius-tool-handlers.ts:178-220`; `M/agents/agent-tools/dobius-tool-server.ts:65-163`; `M/agents/agent-hard-rails.ts`; `M/agents/agent-runner-environment.ts:45-52`; `M/jarvis/self-edit.ts:39-90`; `M/jarvis/jarvis-ipc.ts:112-116`; `M/index.ts:2090-2102`; `M/runtime/runtime-rpc.ts:701-705`; `M/automations/service.ts:184-247`; `M/runtime/rpc/methods/orchestration-gates.ts:44-78`; `M/runtime/rpc/methods/custom-agents.ts:54-172`; `R/components/kanban/board-dispatch.ts:158-181`; `R/components/settings/AsanaPane.tsx:241`.

### Global execution control (design)

One function, `checkExecutionAdmission(origin)` in new `M/agents/execution-gate.ts` (BUILD-001). Every autonomous start path must pass it:

| Path | How it passes the gate | Build |
|---|---|---|
| Kanban dispatch | RPC `agent.run` → `startAgentRun` (default origin = autonomous); renderer poll checks `agents:getPaused` before claiming | 001 |
| Voice Conductor turn + `dobius-spawn` | `startAgentRun` | 001 |
| Asana Auto Mode | tick check (existing `:209`) + check before `claimTask` + `startAgentRun`; blocked start releases the claim | 001 |
| Heartbeats | tick check (existing `:196`, now fail-closed) + `startAgentRun` | 001 |
| Automations | scheduler check before `dispatching` in `M/automations/service.ts` | 002 (Upstream) |
| Orchestration coordinator | `orchestration.run` refuses while blocked | 002 (Upstream) |
| RPC `agent.run` (renderer, Communications chat, workflows) | `startAgentRun` default origin | 001 |
| CLI (`dobius` over unix socket) | same RPC path | 001 |
| iMessage `@Agent` | `startAgentRun`, reply says "paused" | 001 |
| iMessage `d:` → terminal | gate call in `dispatchCommand`; reply, never queued | 001 |
| `dispatch_build` (terminal agent in new worktree) | gate call in the tool handler | 001 |

Rules: **fails closed** (unreadable, malformed, wrong type, or an exception = blocked); the default origin is autonomous; only the Agents page (`M/ipc/agents.ts:133`) passes the exempt `'agents-page'` origin; `startAgentRun` re-checks after its only await. Missing file keeps today's first-use behavior (unpaused).

**ADAM context handshake (X12): later, BUILD-031 in Phase 4.** Consulting ADAM now would make ADAM's availability a precondition for every run before its event delivery and connection config are fixed (#78–#81, #118), and Dobius SDK runs have no ADAM project mapping yet (ADAM admits observed worktree paths, `ADAM/service/src/projects/handshake.ts:110-150`). The gate is written so BUILD-031 adds one check inside the same function, starting with `dispatch-build`.

### Tasks

| Build | Change | Tests | Deps | Risk |
|---|---|---|---|---|
| 001 execution gate (#1, #2) | fail-closed control state; gate module; wire all Dobius start paths | see `BUILD-001.md` | 0 | Medium: may block Communications chat while paused (intended, Decision) |
| 002 engine producers (N13) | automations scheduled runs skip as `skipped_unavailable` "crew paused"; `orchestration.run` refuses | automations/orchestration unit tests | 001 | Low |
| 003 listener switch (N10) | setting controls `enableWebSocket` and bind host | runtime-rpc unit test | — | Medium: phone stops working when off (intended) |
| 004 effective state UI (#119) | `agents:getExecutionState`; Asana pane and Agents header show "Blocked: …" | component tests | 001 | Low |
| 005 path rails (#3, #4, #23, #76) | canonicalize `~`, `$HOME`, `${HOME}`, absolute and symlink paths; token-level Bash scan; cwd failure fails the run; force-push check scoped to the git invocation | `agent-hard-rails.test.ts` extensions, `agent-runner-environment.test.ts` | — | Medium: false denials on legit commands; tests list allowed cases |
| 006 self-edit policy (#26, #27, X1) | check canonical target and parents; `.env*` and credential names denied; explicit repo root | `self-edit.test.ts` | — | Low; C2 stays |
| 007 capability profiles (#7, #6, #73, N3) | per-source tool profile; `dispatch_build` requires build capability + lane + reserved capacity; `tools` separated from `allowedTools`; conductor stops inheriting channel baseline | `dobius-tool-server.test.ts` | 001 | Medium: an agent losing a tool it relied on; profile table reviewed by Carson |
| 008 headless permissions (#74, #75, N1, #8v, X4) | explicit denied outcome for non-manual permission prompts; bypass button disabled when unsupported; fix stale RPC comment | runner tests, SDK contract fixture | 007 | Low |

- **Verification:** `pnpm --dir dobius run typecheck`; `pnpm --dir dobius test`; failure-injection cases F1–F3 in `TEST-PLAN.md`; manual Gate A checklist.
- **Exit criteria:** Gate A and Gate B bug lists merged; every row of ARCHITECTURE-MAP §5.1 has a test proving it is blocked while paused (rows 10, 14, 15 documented exceptions); phone listener can be switched off.

## Phase 2 — Data integrity

- **Goal:** no read error, crash or concurrent write can erase or silently replace user data, identities or secrets.
- **Bug IDs:** 15, 24, 25, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 46, 47, 48, 49, 50, 51, 52, 53; N6.
- **Root cause:** one template copied into ~20 stores: `load()` turns every error into an empty cache and the next save writes that over the original (e.g. `M/agents/agent-runs-store.ts:84-96` writes during load; `M/vertex/vertex-task-store.ts:51-67`; `M/asana/asana-config.ts:86-92`). The primary store restores a backup with a non-atomic write (`M/persistence.ts:2795-2800`) and validates the whole session as one blob (`:3311-3335`). `encrypt()` returns plaintext when safeStorage is unavailable (`M/persistence.ts:224-233`).
- **Files:** see builds 009–021 in `EXECUTION-ORDER.md`.
- **One new abstraction, justified by #28, #29, #30, #34, #35, #46, #47:** `M/storage/safe-json-file.ts` with `{status:'ok'|'missing'|'unreadable'}` load results, no writes during load, a quarantine copy of unreadable files, unique-tmp atomic save, and the canonical data root. Nothing else is abstracted.

| Build | Change | Tests | Deps | Risk |
|---|---|---|---|---|
| 009 (#30, #29, #46) | contract + migrate agents, runs, notifications, briefing, drafts, ledger, asana-config, team store; dismiss hides instead of deleting | table-driven fault injection per store | 001 | High: touches every Dobius store; one store per commit |
| 010 (#28, #47) | board read-only on unreadable; child delete updates parent in one write | vertex store tests | 009 | Medium |
| 011 (#40, #41) | save only edited identity files with revision check; transcript reset keyed to run id | AgentsPage tests | 009 | Low |
| 012 (#36, #37) | atomic protected identity writes; blob publish by tmp rename with size/hash check | identity/blob tests | 009, 017 | Medium |
| 013 (#31, #32, #33, N6) | validate candidate before atomic recovery; per-field session recovery; one writer/generation for save, rotation and quit flush | persistence tests | — | High: engine core store |
| 014 (#53) | one canonical data root for engine users | root fixtures | 013 | Medium |
| 015 (#52) | V2 writer marker; V1 refuses to write | V1/V2 fixture | 014 | Low |
| 016 (#34, #35) | unreadable key/registry → recovery error, never regenerate/erase | keypair/registry tests | 009 | Medium: must not log anyone out silently (house rule) |
| 017 (#25 engine) | durable secret writes fail closed; session-only fallback | safeStorage-unavailable tests | 013 | Medium |
| 018 (#24, #15, #25 comms) | ElevenLabs key into protected store; bridge config 0600; comms key store fail-closed | serialized-state fixtures | 017, 009 | Medium: old backups still hold the key (Decision) |
| 019 (#38, #39) | digest-bound apply; conflict-aware undo | self-edit tests | 006 | Low |
| 020 (#49, #51) | owned tmp cleanup in failure paths; unique tmp names; report errors | fault tests | — | Low |
| 021 (#50, #48) | atomic meta.json; retention for ended sessions, off by default | daemon tests | — | Medium: retention deletes data (Decision) |

- **Verification:** failure-injection F4–F7 and F13 in `TEST-PLAN.md`, run against copies of the Phase 0 snapshot, never the live userData.
- **Exit criteria:** every inventoried store in ARCHITECTURE-MAP §2.2 either uses the contract or has a test showing a failed load performs zero writes; no plaintext secret in any serialized fixture.

## Phase 3 — Agent runtime

- **Goal:** every run has exactly one terminal state, releases every slot it holds, respects its budget on both providers, and is reconciled after a crash.
- **Bug IDs:** 5, 42, 43, 44, 45, 55, 56, 57, 66, 67, 70, 77, 94; N2, N9.
- **Root cause:** no single owner of a run's terminal state. Slots (`reservedRuns`, `inFlightTriageGids`, Kanban `inFlight`, Asana `claimed`) are released by callbacks that the Codex branch (`M/agents/agent-runner.ts:292-322,483`), crashes and fire-and-forget promises never call. Session exclusivity is read from stored history before an await (`:283-290` vs `:324`).
- **Files:** `M/agents/agent-runner.ts`, `M/agents/codex-agent-execution.ts:65-143`, `M/agents/agents-store.ts:293-343`, `M/agents/agent-runs-store.ts:7,116-160`, `M/agents/asana-dispatch-ledger.ts`, `M/agents/asana-auto-mode-service.ts`, `M/agents/agent-heartbeat-service.ts:61-67,155-191`, `R/components/kanban/board-dispatch.ts:107-175`, `M/vertex/vertex-task-store.ts`.

| Build | Change | Tests | Deps | Risk |
|---|---|---|---|---|
| 022 (#5, #55, #67, #70) | one exactly-once finalizer for both providers; Codex caps enforced or run rejected; configured Codex path; stdin error handled | codex execution tests | 008 | Medium |
| 023 (#56, #57, N2, #42, #77) | synchronous session-key reservation; reset clears keyed sessions; live runs outside history cap; outbox byte budget | runner/store tests | 022, 009 | Medium |
| 024 (#43, #44, #45, #66) | claim lease + startup reconciliation; dead-letter kept past prune; "blocked" when no triage agent; due-time heartbeat schedule | ledger/heartbeat tests | 009, 022 | Medium |
| 025 (#94, N9) | slot released on update failure; main-side reconciliation of `running` cards | board tests | 010, 023 | Low |

- **Verification:** F8 (crash mid-run), F9 (Codex missing), F10 (Claude failure), F12 (duplicate events).
- **Exit criteria:** Gate B and the runtime half of Gate C merged; no path leaves a slot held after success, error, cancel or crash (tests per path).

## Phase 4 — Orchestration, automation, ADAM

- **Goal:** engine schedulers and the coordinator survive restarts; Asana intake is complete; ADAM receives every event and, last, admits autonomous terminal launches.
- **Bug IDs:** 54, 62, 63, 64, 65, 68, 69, 71, 72, 78, 79, 80, 81, 118, 120; N4, N5; X12.
- **Root cause:** persisted "running/dispatching" rows outlive their in-memory owners (`M/runtime/rpc/methods/orchestration-gates.ts:49-93`, `M/automations/service.ts:234-245`); mixed timestamp formats (`M/runtime/orchestration/db.ts:600-607` vs `coordinator.ts:233`); append and network delivery share one promise chain (`M/agents/agent-run-event-journal.ts:103-116`); two ADAM resolvers (`M/jarvis/adam-client.ts:8-27` vs journal `:37-58`); wrong Asana query (`M/asana/asana-client.ts:124`).

| Build | Change | Tests | Deps | Risk |
|---|---|---|---|---|
| 026 (#62–#65) | startup reconciliation of coordinator rows; numeric UTC timestamps; attempt-bound escalation; root-scoped convergence | orchestration tests | 002 | Medium: DB migration must be additive |
| 027 (#68, #69, #71) | claim completion before await; interrupted `dispatching` on startup; owned catch on every background promise | automations tests | 002 | Low |
| 028 (#54, #72, #120) | lane-correct queries, pagination, `allowedProjects` applied | fixed-clock fixtures | 024 | Low |
| 029 (#78–#80, N4, N5) | durable outbox with cursor and backoff; one journal dir; replay after store and off the critical path | offline/online tests | — | Low |
| 030 (#81, #118) | one ADAM connection registry; no hardcoded `~/dobius/projects/ADAM` | registry tests | 029 | Low |
| 031 (X12) | gate consults ADAM handshake for `dispatch-build` | refusal-code tests | 001, 007, 030 | Medium: ADAM offline policy (Decision) |

- **Verification:** F2 (ADAM offline), F12 (duplicate events), F8 (crash mid-run) for coordinator and automations.
- **Exit criteria:** Gate C list merged.

## Phase 5 — Remote, phone, iMessage

- **Goal:** only Carson, from his own chat and his own paired phone, can send commands or approvals, and each is bound to one action.
- **Bug IDs:** 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 121; N11, N12; X3, X5, X8.
- **Root cause:** "a newer row in a chat whose GUID contains the handle" is treated as an authenticated command or consent (`M/imessage-bridge/bridge-service.ts:31-40`, `M/voice-conductor/imessage-bridge.ts:47-60,118-135`); the watermark is not tied to dispatch (`bridge-service.ts:214-216`); RPC authority depends on transport (`M/ipc/runtime.ts:33-45` passes `'desktop-ipc'`; `M/runtime/rpc/dispatcher.ts:45-80` checks nothing); the WS handshake has no server challenge (`M/runtime/rpc/e2ee-channel.ts:153-216`).

| Build | Change | Tests | Deps | Risk |
|---|---|---|---|---|
| 032 (#12, #13, #14, #16, N12) | exact chat identity; per-message dispatch record; handle validation; terminal guard (foreground agent check at send time, explicit target); `/tabSend` timeout | bridge tests | 001 | Medium: guard must not break the kept feature |
| 033 (#9, #10, #11, #121, X3, X5) | real host-enforced confirm bound to action id, sender, expiry; handle and lane GIDs from Settings | conductor bridge tests | 032, 007 | Medium |
| 034 (#21, #18) | IPC sender/frame check; capability context in dispatcher; per-method mobile grants | dispatcher tests | 003 | High: engine RPC core |
| 035 (#17, #19, #20, #22, X8, N11) | versioned challenge handshake with replay rejection; QR expiry and single use; accept-time auth deadline; constant-time compare; socket cleanup | transport tests | 034, 016 | High: phones must re-pair (Decision) |

- **Verification:** F11 (phone replay), F12 (duplicate iMessage rows).
- **Exit criteria:** Gates D (messaging half) and E merged.

## Phase 6 — Voice

- **Goal:** voice sessions start, stop and clean up exactly once; the conductor runs one owned turn at a time with a visible budget.
- **Bug IDs:** 58, 59, 60, 61, 82, 83, 84, 85, 86 (verify), 87, 88, 89, 90, 91, 92, 123; X7; #122-F9.
- **Root cause:** capture, connection and playback have no owner with a generation id (`R/components/jarvis/use-jarvis-turn.ts:51,96,305`, `R/hooks/use-audio-capture.ts:286`, `R/components/jarvis/use-voice-agent.ts:49-86`); cloud calls have no timeout (`M/speech/openai-transcription-client.ts:78-86`); conductor tracks one `currentRunId` (`M/voice-conductor/conductor.ts:188-192`).

| Build | Change | Tests | Deps | Risk |
|---|---|---|---|---|
| 036 (#58–#61) | queue until settle; track all owned runs; visible budget; managed-default migration; enforced one-item reservation | conductor tests | 033, 022, 023 | Medium |
| 037 (#82, #83, #88, X7) | stable capture API; connection generation + late-session close; specific no-model status; single capture owner | hook tests | — | Medium: paid ElevenLabs sessions |
| 038 (#87, #89, #90, #91, #122-F9) | cache only successful discovery; route ⌘T to controller window; temp dir finalizer; no replay after partial playback; surface shortcut failure | jarvis tests | 019 | Low |
| 039 (#84, #85, #92, #123, #86v) | timeouts + cancel; 10-min segmenting; stable hold gesture; configured VPS endpoint | speech tests | — (sequential with 037 on `use-audio-capture.ts`) | Low |

- **Verification:** F10 (Claude failure during a conductor turn); manual voice checklist (Carson at the machine; paid calls).
- **Exit criteria:** Gate D list merged.

## Phase 7 — UI behavior

- **Goal:** what the screens show is true.
- **Bug IDs:** 93, 95, 96, 97, 98, 99; X6.
- **Root cause:** renderer state derived from object identity or a single failed call and shown as current (`R/components/kanban/KanbanBoard.tsx:436,589`, `R/components/automations/AutomationsPage.tsx:1008-1066,1750-1820`, `R/components/agents/AgentLivePulse.tsx:45`, `R/components/agents-hub/AgentsOverview.tsx:133`).

| Build | Change | Tests | Deps | Risk |
|---|---|---|---|---|
| 040 (#93, #95) | app-owned notes dialog; finite completion value | component tests | 025 | Low |
| 041 (#98, #99, X6) | age labels; distinct-agent count; Generate marked unavailable | component tests | 011, 023 | Low |
| 042 (#96, #97) | visible mutation errors; narrow refetch dependencies | component tests | 027 | Low |

No redesign: existing components and tokens from `dobius/docs/STYLEGUIDE.md` only.

## Phase 8 — Build and release

- **Goal:** one installer that cannot leave Carson without a working app, truthful versions and provenance, a complete artifact, and an update path that is either fully on or visibly off.
- **Bug IDs:** 100, 101, 102, 103, 104, 105, 106, 107, 109, 110, 111, 112, 114; N8; X2; Carson's version-bump request.
- **Root cause:** three installer entry points with different guarantees (`build-and-install.sh:41` → `scripts/install-dobius-v2.sh:73` `rm -rf`; `scripts/install-dobius-gated.sh:28,48,64,93`); partial build graph (`build-and-install.sh:30-31` vs `dobius/package.json:58-72`); updater switches in three places (`M/dobius-disconnect.ts:4`, `M/window/attach-main-window-services.ts:163`, `M/updater.ts:948-956,1040,1338-1361`).

| Build | Change | Tests | Deps | Risk |
|---|---|---|---|---|
| 043 (#100, #103, #104, #105, #112) | gated installer becomes the only path: lock first, stage, validate, swap, keep rollback copy outside `/Applications` and `dobius/dist`; retire v2 script; hook stays advisory | shell harness on fixture dirs | — | Medium |
| 044 (#102, #109, #110, N8, X2, bump) | SemVer compare incl. prerelease; missing version refused; provenance records dirty flag, diff digest, build number; **automatic version bump** | script tests | 043 | Low |
| 045 (#101, #114) | full `build:unpack` graph; artifact manifest check incl. `out/cli/index.js`; Node 24 check | manifest test | 043 | Low |
| 046 (#106, #107, #111) | one update policy for setup, scheduled checks and download; disabled ≠ up to date; remove dead dev feed | truth-table tests | 044 | Medium |

### Automatic version bump on every build/install (Carson's request)

- **What:** every successful `build:unpack` through the installer gets a new, strictly increasing build identity, visible in About and in `INSTALL-PROVENANCE.json`.
- **Recommended shape:** keep the marketing version in `dobius/package.json` (`2.0.0`) and add a monotonic **build number** passed to electron-builder as `buildVersion` (`CFBundleVersion`). Store the counter outside the repo (`~/.dobius-build-counter`) so a bump never dirties the tree and never needs a commit. Show "2.0.0 (build N)". The downgrade guard compares `(version, prerelease, buildNumber)`.
- **Alternative (Decision):** bump the patch version in `package.json` and commit it on every install. Simpler to read, but every install creates a commit and a dirty-tree window.
- **Where:** `scripts/install-dobius-gated.sh` (reads/increments the counter under the install lock), `dobius/config/electron-builder.config.cjs` (`buildVersion`), provenance JSON.

### In-app update path (what must change for auto-update to work)

1. **Policy:** replace the constant `DOBIUS_SERVICES_DISCONNECTED = true` (`M/dobius-disconnect.ts:4`) and the env gate `DOBIUS_ENABLE_DOBIUS_UPDATES` (`attach-main-window-services.ts:163`) with one policy read by setup, background, wake, 24 h, menu check and download (`M/updater.ts:948-956,1040,1338-1361`). Today background checks ignore the disconnect switch (#106) and the menu says "up to date" when disabled (#107).
2. **Feed:** `publish` points at GitHub `statusdigitalmarketing/dobius-plus` (`dobius/config/electron-builder.config.cjs:366-369`). Releases with `latest-mac.yml` must exist there. `dev-app-update.yml` points at the wrong repo (#111).
3. **Signing:** electron-updater on macOS installs only onto a properly signed app, and the replacement must be signed by the same identity. The app is ad-hoc signed today (NOTES 2026-07-12) and notarization runs only when `isMacRelease` (`electron-builder.config.cjs:235`). Auto-update therefore needs a Developer ID certificate, notarization, and one signed install before the first auto-update. Whether Carson has an Apple Developer account is **UNDETERMINED**.
4. **Provenance and install gate:** an update installed by electron-updater bypasses `install-dobius-gated.sh`. Either the updater writes the same provenance record, or Carson keeps local builds on the gated installer and uses auto-update only for published releases (Decision).
5. **Rebrand protection:** the comment at `attach-main-window-services.ts:160-162` says updates were disabled so the feed cannot overwrite the rebrand. The feed must be Carson's own releases before enabling.

- **Verification:** fixture-directory install tests only; never against `/Applications` from an agent.
- **Exit criteria:** Gate F list merged; `build-and-install.sh` and `install-dobius-v2.sh` can no longer delete the installed app.

## Phase 9 — Config and docs

- **Goal:** every setting does what it says; docs and agent instructions describe V2; lint passes; every session gets an accurate workspace description.
- **Bug IDs:** 108, 113, 115, 116, 117 (verify), 122 (F8, F11); X9; WORKSPACE.md.
- **Root cause:** the same value defined as env, constant and setting in different modules (ARCHITECTURE-MAP §11); instructions still describe V1 (`CLAUDE.md`, `.claude/CLAUDE.md`, `dobius/AGENTS.md:1-17` names `/Users/bayou/Projects (Code)/dobius-plus`).

| Build | Change | Tests | Deps | Risk |
|---|---|---|---|---|
| 047 (#122, X9) | telemetry toggle labeled unavailable; Markdown Review Notes wired or retired; orphan settings resolved; Settings CLI path wins over env | settings tests | — | Low |
| 048 (#108, #113, #116, #117v) | rewrite release/agent docs from V2 scripts; skill points at the one installer; close #117 (external note already corrected) | scripted path check | 043–045 | Low |
| 049 (#115) | lint debt to zero or a shrinking agreed allowlist; no `max-lines` disables | `pnpm --dir dobius run lint` | 048 | Medium: large mechanical diff; split per directory |
| 050 (WORKSPACE.md) | see below | generator unit test | 031, 048 | Low |

### Generated per-session WORKSPACE.md (Carson's request, plan item)

- **Requirement:** every terminal and agent session starts with a detailed, current description of its workspace: repo, branch, worktree, what the app/folder is, which features live where, which commands build and test it, what is off-limits, current stabilization gate.
- **Generated from:** (1) ADAM's context pack for the observed worktree path (`/Users/bayou/dobius/projects/ADAM/service/src/projects/handshake.ts:110-150`, `resolveContextPack`), available after BUILD-030/031; (2) a checked-in feature map derived from ARCHITECTURE-MAP (component → paths → owner layer); (3) live facts (branch, dirty state, gate state from the execution gate).
- **Lives at:** `CLAUDE.local.md` in the session's worktree for Claude Code (read automatically, and gitignored so it never gets committed); for Codex, the `AGENTS.md` mechanism: a generated `AGENTS.override.md` or an include from the worktree's `AGENTS.md` (exact Codex precedence **UNDETERMINED**; confirm before building).
- **Task outline (one task):** add a generator in the Dobius layer that runs when a terminal agent or SDK run starts in a worktree (hook point: the managed-worktree startup path and `startAgentRun`'s cwd resolution), writes the file atomically, never includes secrets, and skips silently-but-logged when ADAM is offline (falls back to the feature map only).

- **Exit criteria:** docs path check passes; lint gate agreed; WORKSPACE.md appears in a new worktree session.

## Phase 10 — Full regression

- **Goal:** prove the whole program together on the real machine, then return capabilities gate by gate.
- **Tasks:** full `TEST-PLAN.md` ladder on the integration branch; gated install; Carson flips Gate A→F settings in order, one gate per day, watching spend, run list, and `logs/main.trace.ndjson`.
- **Exit criteria:** all gates passed; Phase 0 snapshot retained until Carson releases it; `BUILD-LOG.md` entry per build.
