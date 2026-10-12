# Dobius+ V2 — Execution order (BUILD-001 … BUILD-050)

Date: 2026-09-24. Branch base: `stabilize/iris-20260923`. Inputs: `BUG-LIST-123.md` (canonical IDs), `BUG-MATRIX.md` (Run A, Codex), `ARCHITECTURE-MAP.md` (Run A, Claude), plus source re-reads done for this run (noted "re-read 09-24").

Path conventions (same as Run A): `M/` = `dobius/src/main/`, `R/` = `dobius/src/renderer/src/`, `S/` = `dobius/src/shared/`, `P/` = `dobius/src/preload/`. Repo-root paths (`scripts/`, `build-and-install.sh`, `electron/`) are relative to `/Users/bayou/Projects (Code)/Dobius/dobius-plus`. Line numbers come from Run A or from this run's re-reads; a coding agent re-confirms them before editing.

## Rules this order follows

- One architectural concern per build, at most 8 items (bugs + N/X items).
- **Layer tag on every build.** `Dobius` = Dobius+ layer (`M/agents/`, `M/asana/`, `M/imessage-bridge/`, `M/voice-conductor/`, `M/dobius-cli/`, `M/jarvis/`, `M/vertex/`, `M/communications/`, Dobius renderer pages, repo scripts). `Upstream` = inherited Orca engine (`M/runtime/`, `M/daemon/`, `M/persistence.ts`, `M/automations/`, `M/speech/`, `M/updater*.ts`, `M/agent-hooks/`, `M/browser/`, `M/stats/`, `M/telemetry/`, engine renderer). Classification follows ARCHITECTURE-MAP §14. **No build mixes the two.** A Dobius build may *call* an engine export without editing it, and an Upstream build may call the Dobius gate API without editing Dobius files.
- `M/runtime/rpc/methods/custom-agents.ts` is treated as Dobius layer: it only wraps the Dobius agents store/runner. Inference from content; git cannot separate it (first appears in vendoring commit `caee2df0`). `M/index.ts` and `M/ipc/register-core-handlers.ts` are Mixed; a Dobius build may touch only the Dobius wiring lines named in that build.
- Every bug 1–123 has exactly one owning build. Two canonical rows are compound across layers and are split explicitly (see "Split rows"). Refuted / could-not-locate rows are owned by a build as **verify-only**.
- Rollback for every build = revert its merge commit on the integration branch. Builds that touch persisted data also say what happens to files already written by the new code.

## Order at a glance

| Phase | Builds |
|---|---|
| 0 Baseline (no code) | see `BASELINE.md` |
| 1 Safety foundation | 001, 002, 003, 004, 005, 006, 007, 008 |
| 2 Data integrity | 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 021 |
| 3 Agent runtime | 022, 023, 024, 025 |
| 4 Orchestration + automation + ADAM | 026, 027, 028, 029, 030, 031 |
| 5 Remote / phone / iMessage | 032, 033, 034, 035 |
| 6 Voice | 036, 037, 038, 039 |
| 7 UI behavior | 040, 041, 042 |
| 8 Build + release | 043, 044, 045, 046 |
| 9 Config + docs | 047, 048, 049, 050 |
| 10 Full regression (no code) | see `TEST-PLAN.md` |

---

## Phase 1 — Safety foundation

### BUILD-001 — Global execution gate, fail-closed pause · Dobius
- **Bugs:** #1, #2
- **Depends on:** Phase 0 baseline only.
- **Files:** `M/agents/agents-config-store.ts:59-128`; new `M/agents/execution-gate.ts`; `M/agents/agent-runner.ts:81-102,257-276,324-326`; `M/ipc/agents.ts:131-134,178-182`; `M/agents/agent-tools/dobius-tool-handlers.ts:178-213`; `M/agents/asana-auto-mode-service.ts:149-156,169-175`; `M/agents/asana-dispatch-ledger.ts` (new `releaseClaim`); `M/agents/agent-channel-service.ts:156-158`; `M/imessage-bridge/bridge-service.ts:252-274`; `R/components/kanban/board-dispatch.ts:158-181,201`.
- **Test that proves it:** `M/agents/agents-config-store.test.ts` (malformed JSON, EACCES, non-boolean flag → effective paused, zero writes), `M/agents/execution-gate.test.ts`, `M/agents/agent-runner-admission.test.ts` (paused → throws before reservation; pause during `prepareClaudeLaunch` await → throws after), board/iMessage/dispatch_build/Asana cases. Full spec in `BUILD-001.md`.
- **Rollback:** revert. No file format change; `agents-config.json` stays readable by the old code.

### BUILD-002 — Engine producers honor the gate · Upstream
- **Bugs:** N13 (automations scheduler and `orchestration.run` ignore "Pause crew"; ARCHITECTURE-MAP §5.1 rows 5 and 13).
- **Depends on:** BUILD-001.
- **Files:** `M/automations/service.ts:66-78,184-205,207-247` (scheduled runs skip with existing status `skipped_unavailable` and a "crew paused" error; manual `runNow` :88 stays allowed); `M/runtime/rpc/methods/orchestration-gates.ts:44-78` (`orchestration.run` refuses while blocked).
- **Test:** `M/automations/service-admission.test.ts` (paused tick records `skipped_unavailable`, no `automations:dispatchRequested` send); orchestration gate unit test that a paused state rejects `orchestration.run` before a coordinator row is inserted.
- **Rollback:** revert; runs recorded as skipped stay skipped (truthful history).

### BUILD-003 — LAN listener off switch · Upstream
- **Bugs:** N10 (`M/index.ts:2097` hardcodes `enableWebSocket: true`; the phone WebSocket on `0.0.0.0:6768` cannot be turned off).
- **Depends on:** — (parallel-safe with 001).
- **Files:** `M/index.ts:2090-2102` (engine startup lines only), `M/runtime/runtime-rpc.ts:701-705` (bind host from option), settings type in `S/types.ts` + default in `S/constants.ts`. Default value is a **Decision for Carson** (recommended: off until Gate E).
- **Test:** unit test that `DobiusRuntimeRpcServer` with the switch off creates no WS server; with it on and loopback-only, binds `127.0.0.1`.
- **Rollback:** revert; phones reconnect on next launch with the old always-on behavior.

### BUILD-004 — Effective execution state in UI · Dobius
- **Bugs:** #119
- **Depends on:** BUILD-001.
- **Files:** `M/ipc/agents.ts:178-182` (new `agents:getExecutionState` returning `{paused, status, reason}`), `P/index.ts:1157-1159`, `R/components/settings/AsanaPane.tsx:241`, `R/components/agents/AgentsPageHeader.tsx:44`, `R/components/agents/AgentsPage.tsx:129,300-307`.
- **Test:** component test that Auto Mode enabled + paused renders "Blocked: crew paused"; unreadable state renders the file path and blocks the Resume button.
- **Rollback:** revert; gate keeps enforcing, only the label disappears.

### BUILD-005 — Protected-path rails · Dobius
- **Bugs:** #3, #4, #23, #76
- **Depends on:** —
- **Files:** `M/agents/agent-hard-rails.ts:12-23,50-66,70-104,134-157`; `M/agents/agent-runner-environment.ts:25,45-52`; reuse candidate `M/communications/providers/protected-path-guard.ts` (content UNVERIFIED).
- **Test:** extend `M/agents/agent-hard-rails.test.ts`: `$HOME/.claude/.credentials.json`, `/Users/<u>/.dobius/...`, `${HOME}`, symlink, mid-command paths denied; `git push && rm -rf dist` allowed; `git push -f` denied. New `M/agents/agent-runner-environment.test.ts`: unwritable cwd → run rejected, no fallback to home.
- **Rollback:** revert; rails return to regex form.

### BUILD-006 — Jarvis self-edit path policy · Dobius
- **Bugs:** #26, #27, X1
- **Depends on:** — (never changes C2 behavior: Jarvis still applies its own approved edits).
- **Files:** `M/jarvis/self-edit.ts:39-44,80-90`; `M/jarvis/jarvis-ipc.ts:112-116` (explicit repo root instead of two parents of `app.getAppPath()`).
- **Test:** `M/jarvis/self-edit.test.ts`: in-root symlink to `.env.local` / forbidden dir denied; `.env.production` denied; ordinary source edit allowed; packaged root resolves to configured repo, not bundle `Contents`.
- **Rollback:** revert.

### BUILD-007 — Run capability profiles · Dobius
- **Bugs:** #7, #6, #73, N3
- **Depends on:** BUILD-001 (same files: `agent-runner.ts`, `dobius-tool-handlers.ts`).
- **Files:** `M/agents/agent-runner.ts:341-356`; `M/agents/agent-runner-dobius-tools.ts:4-8`; `M/agents/agent-tools/dobius-tool-server.ts:65-163`; `M/agents/agent-tools/dobius-tool-handlers.ts:178-220`; `M/voice-conductor/conductor.ts:22-30,101` (N3: channel baseline tools unioned into the conductor agent).
- **Test:** `dobius-tool-server.test.ts`: triage/heartbeat/channel profiles get exactly their tool set; `dispatch_build` denied without build capability, lane check and capacity reservation; `tools` vs `allowedTools` query-argument fixture.
- **Rollback:** revert; profiles removed, wildcard grant returns.

### BUILD-008 — Headless permission outcomes · Dobius
- **Bugs:** #74, #75, N1, #8 (verify-only), X4
- **Depends on:** BUILD-007.
- **Files:** `M/agents/agent-runner.ts:100-106,391-398`; `M/agents/agent-decision-queue.ts:80-113`; `M/runtime/rpc/methods/custom-agents.ts:54-70,140-172` (N1: non-channel RPC sources get no `canUseTool`; #8: correct the stale "startAgentRun has NO default budget" comment at :61-64, runner defaults are $2/$1 and 100 turns per `agent-runner.ts:362-366`); agent edit form text (X4; exact component path UNDETERMINED — Run A cites "agent edit form", locate with `rg "unchanged in Phase 1" dobius/src/renderer`).
- **Test:** runner test: heartbeat/asana/RPC-manual run hitting a permission prompt produces a visible denied outcome, never a silent hang; bypass button disabled when SDK transition unsupported (SDK contract fixture).
- **Rollback:** revert.

---

## Phase 2 — Data integrity

### BUILD-009 — Safe JSON store contract + agents-domain stores · Dobius
- **Bugs:** #30, #29, #46
- **Depends on:** BUILD-001 (ledger touched there).
- **Files:** new `M/storage/safe-json-file.ts` (load result `{status:'ok'|'missing'|'unreadable'}`, never writes during load, quarantine copy, atomic unique-tmp save, root from existing `getCanonicalUserDataPath()` `M/persistence.ts:446`); migrate `M/agents/agents-store.ts:119-145`, `M/agents/agent-runs-store.ts:84-110`, `M/agents/agent-notification-store.ts`, `M/agents/agent-briefing-store.ts:94-106`, `M/agents/agent-draft-store.ts`, `M/agents/asana-dispatch-ledger.ts:52-89`, `M/asana/asana-config.ts:86-100`, `M/communications/team-store.ts:124`.
- **Test:** table-driven `M/storage/safe-json-file.test.ts` (malformed, partial, EACCES read, EACCES write, rename failure, two writers) + one test per migrated store: failed load performs zero writes; briefing dismiss keeps older history.
- **Rollback:** revert. Quarantined `*.unreadable-<ts>` copies stay on disk (never auto-deleted).

### BUILD-010 — Kanban store integrity · Dobius
- **Bugs:** #28, #47
- **Depends on:** BUILD-009.
- **Files:** `M/vertex/vertex-task-store.ts:47-70,295`.
- **Test:** `M/vertex/vertex-task-store.test.ts`: malformed/EACCES board then create → original bytes intact, store read-only with error; delete child removes id from parent in the same write.
- **Rollback:** revert.

### BUILD-011 — Agent identity save safety · Dobius
- **Bugs:** #40, #41
- **Depends on:** BUILD-009.
- **Files:** `R/components/agents/AgentsPage.tsx:134,141,230`; `M/agents/agent-identity-files.ts:63`.
- **Test:** agent appends to memory.md while form open, save tagline → memory preserved (revision check); tagline edit during streaming keeps transcript.
- **Rollback:** revert.

### BUILD-012 — Communications identity and blobs · Dobius
- **Bugs:** #36, #37
- **Depends on:** BUILD-009, BUILD-017 (encryption must fail closed first).
- **Files:** `M/communications/participant-identity-store.ts:107,150`; `M/communications/agent-participant-identity-store.ts:52,94`; `M/communications/workstation/media/blob-store.ts:139`.
- **Test:** transient read/decrypt denial keeps the same identity; interrupted blob write then same-hash retry yields complete verified content.
- **Rollback:** revert; identities written atomically remain valid for old code (same format).

### BUILD-013 — Primary store recovery · Upstream
- **Bugs:** #31, #32, #33, N6
- **Depends on:** —
- **Files:** `M/persistence.ts:2728-2800,3311-3357,3699-3710` (N6 = `restoreFromBackup` `writeFileSync` straight over primary at :2795-2800).
- **Test:** bad migration + mixed valid/invalid `.bak.N` recovers newest valid without touching any candidate; one invalid `workspaceSession` field keeps other tabs; async rotation interleaved with sync quit flush keeps five generations.
- **Rollback:** revert.

### BUILD-014 — One data root · Upstream
- **Bugs:** #53
- **Depends on:** BUILD-013 (same file), BUILD-003 (adjacent `M/index.ts` lines 2089 / 2090-2102).
- **Files:** `M/persistence.ts:319-323,446-450`; `M/index.ts:584,2089` (engine lines); `M/ipc/runtime-environments.ts:47`. Dobius stores already converge through BUILD-009.
- **Test:** dev/packaged/remote profile fixtures resolve one stable root before and after `app.setName`.
- **Rollback:** revert.

### BUILD-015 — Legacy V1 isolation · Dobius
- **Bugs:** #52
- **Depends on:** BUILD-014.
- **Files:** `M/migrate-legacy-dobius-config.ts:46,122-128`; legacy `electron/config-manager.js:6-11`, `electron/main.js:376` (V1 refuses to start / write when a V2 writer marker exists).
- **Test:** fixture V1 and V2 launches against one temp dir cannot overwrite each other's files.
- **Rollback:** revert; marker file is inert for old code.

### BUILD-016 — Remote identity persistence · Upstream
- **Bugs:** #34, #35
- **Depends on:** BUILD-009 (reuses `safe-json-file.ts` API without editing it).
- **Files:** `M/runtime/e2ee-keypair.ts:45-58`; `M/runtime/device-registry.ts:115-131`.
- **Test:** EACCES / corrupt keypair → recovery error, no new key written; unreadable registry → pairing mutations blocked, no erase.
- **Rollback:** revert.

### BUILD-017 — Secret storage fails closed (engine owners) · Upstream
- **Bugs:** #25 (engine part: `M/persistence.ts:224-233`, `M/speech/openai-api-key-store.ts:57`)
- **Depends on:** BUILD-013 (same file).
- **Test:** `safeStorage.isEncryptionAvailable() === false` or `encryptString` throws → no plaintext written; existing encrypted values intact; session-only use works.
- **Rollback:** revert.

### BUILD-018 — Dobius secrets · Dobius
- **Bugs:** #24, #15, #25 (Dobius part: `M/communications/providers/provider-api-key-store.ts:44`)
- **Depends on:** BUILD-017, BUILD-009.
- **Files:** `M/jarvis/elevenlabs-client.ts:14-25` + new `M/jarvis/elevenlabs-key-store.ts` (safeStorage, fail closed); one-time migration that moves `settings.voice.elevenlabsApiKey` out of settings through the public Store API; `M/imessage-bridge/bridge-config.ts:70-82` (mode 0600 on write + chmod existing file); provider key store fail-closed.
- **Test:** serialized primary/backup fixture has no key after migration; migration failure keeps access; bridge config created under umask 022 ends 0600.
- **Rollback:** revert; key stays in the protected store, so the reverted build must read env/settings — document the manual re-entry step. Existing backups that already contain the key are **not** deleted; remediation is a Carson decision.

### BUILD-019 — Self-edit concurrency and undo · Dobius
- **Bugs:** #38, #39
- **Depends on:** BUILD-006.
- **Files:** `M/jarvis/self-edit.ts:158,185-190`; `M/jarvis/jarvis-ipc.ts:118`.
- **Test:** external edit between propose and apply → conflict, file untouched; apply then undo restores bytes; undo after a later edit → conflict.
- **Rollback:** revert.

### BUILD-020 — Temp-file hygiene · Upstream
- **Bugs:** #49, #51
- **Depends on:** —
- **Files:** `M/stats/collector.ts:262-266` (no cleanup at all); `M/agent-hooks/server.ts:1596-1620` (re-read 09-24: unlinks only when `tmpWritten` is true, so a partial write that throws leaves the tmp — #49 stands for both writers, correcting ARCHITECTURE-MAP Appendix A); `M/browser/browser-session-registry.ts:76-86`.
- **Test:** injected write/rename failures leave primary valid and no owned tmp; sweep keeps another writer's live tmp.
- **Rollback:** revert.

### BUILD-021 — Daemon history integrity and retention · Upstream
- **Bugs:** #50, #48
- **Depends on:** —
- **Files:** `M/daemon/history-manager.ts:85,302-308,336`; `M/daemon/daemon-init.ts:74`.
- **Test:** interrupted meta.json update keeps terminal identity; mixed active/ended archives over quota sweep only ended ones.
- **Rollback:** revert. Retention deletes ended-session data; ship it **disabled by default** until Carson sets a quota (Decision).

---

## Phase 3 — Agent runtime

### BUILD-022 — Codex provider parity · Dobius
- **Bugs:** #5, #55, #67, #70
- **Depends on:** BUILD-008 (same runner file).
- **Files:** `M/agents/agent-runner.ts:292-322,439-500`; `M/agents/codex-agent-execution.ts:65-143`; `M/agents/agent-heartbeat-service.ts:155-191`.
- **Test:** extend `M/agents/codex-agent-execution.test.ts`: fake stream exceeds budget/turn caps → stop; success/error/cancel each call the finalizer exactly once and release the Asana triage slot; ENOENT and stdin EPIPE produce one failed run, no uncaught error; heartbeat on Codex either honors model/verdict or is rejected before spawn.
- **Rollback:** revert.

### BUILD-023 — Run sessions and history · Dobius
- **Bugs:** #56, #57, N2, #42, #77
- **Depends on:** BUILD-022, BUILD-009.
- **Files:** `M/agents/agent-runner.ts:278-290`; `M/agents/agents-store.ts:293-343`; `M/agents/agent-channel-service.ts:104-150` (N2: iMessage `@Agent` runs share the `'default'` sessionKey); `M/agents/agent-runs-store.ts:7,116-160`.
- **Test:** barrier two starts at `prepareClaudeLaunch` → only one resumes; reset clears keyed sessions; >50 runs with older ones live → all get completion; outbox stays under byte budget.
- **Rollback:** revert.

### BUILD-024 — Dobius producer reconciliation · Dobius
- **Bugs:** #43, #44, #45, #66
- **Depends on:** BUILD-009, BUILD-022.
- **Files:** `M/agents/asana-dispatch-ledger.ts:99-176`; `M/agents/asana-auto-mode-service.ts:38-44,159-185`; `M/agents/agent-heartbeat-service.ts:61-67`.
- **Test:** crash after claim → next start reconciles, no 30-day skip, no double launch; dead-letter survives prune; no triage agent → "blocked" not "briefed"; delayed tick fires one hourly heartbeat.
- **Rollback:** revert; ledger records gain optional fields that old code ignores.

### BUILD-025 — Kanban dispatch recovery · Dobius
- **Bugs:** #94, N9
- **Depends on:** BUILD-010, BUILD-023.
- **Files:** `R/components/kanban/board-dispatch.ts:107-156` (N9: `inFlight.add` at :121 before an awaited update outside try/finally; :174 fire-and-forget with no catch); `M/vertex/vertex-task-store.ts` (startup reconciliation of `dispatch.status === 'running'` against live runs).
- **Test:** update rejection releases the slot; crash between claim/launch/settle → card converges to real state and can be retried by the operator.
- **Rollback:** revert.

---

## Phase 4 — Orchestration, automation, ADAM

### BUILD-026 — Orchestration coordinator correctness · Upstream
- **Bugs:** #62, #63, #64, #65
- **Depends on:** BUILD-002 (same gate file).
- **Files:** `M/runtime/rpc/methods/orchestration-gates.ts:44-95`; `M/runtime/orchestration/db.ts:600-607,692-710,845-849`; `M/runtime/orchestration/coordinator.ts:207-330,555-570`.
- **Test:** restart with a `running` row → stop/restart works without `resetAll`; midnight-crossing hung check; stale escalation cannot fail a newer attempt; two roots converge independently.
- **Rollback:** revert; timestamp migration must be additive (keep old column readable).

### BUILD-027 — Automations lifecycle · Upstream
- **Bugs:** #68, #69, #71
- **Depends on:** BUILD-002.
- **Files:** `M/automations/service.ts:66-78,136-165,207-247`; `M/runtime/rpc/methods/orchestration-gates.ts:74-78` (the coordinator half of #71).
- **Test:** two completion signals → one notification/usage record; crash while `dispatching` → startup marks interrupted; rejected tick → recorded diagnostic, no unhandled rejection.
- **Rollback:** revert.

### BUILD-028 — Asana intake · Dobius
- **Bugs:** #54, #72, #120
- **Depends on:** BUILD-024.
- **Files:** `M/asana/asana-client.ts:118-140`; `M/asana/asana-config.ts:78`; `M/asana/asana-queue-service.ts:88`.
- **Test:** fixed-clock fixtures: review lane returns older completed tasks; >50 tasks across pages deduplicated; `allowedProjects` filters (empty list = documented meaning).
- **Rollback:** revert.

### BUILD-029 — ADAM event delivery · Dobius
- **Bugs:** #78, #79, #80, N4, N5
- **Depends on:** —
- **Files:** `M/agents/agent-run-event-journal.ts:24-58,76-120` (N4: journal dir differs pre/post ready); `M/index.ts:1630-1632` (N5: replay fired before `store`; Dobius wiring line in a Mixed file).
- **Test:** offline ADAM does not delay append; poison record skipped/quarantined, later events delivered; missing token → pending + visible health; >1,000 backlog delivered once logically.
- **Rollback:** revert; cursor file is additive.

### BUILD-030 — ADAM connection registry · Dobius
- **Bugs:** #81, #118
- **Depends on:** BUILD-029, BUILD-019 (both edit `M/jarvis/self-edit.ts`).
- **Files:** `M/jarvis/adam-client.ts:8-27`; `M/agents/agent-run-event-journal.ts:37-58`; `M/jarvis/self-edit.ts:39-41`.
- **Test:** changing connection settings updates both converse and events without restart; missing ADAM dir → configured "not installed" state, no crash; token never logged.
- **Rollback:** revert.

### BUILD-031 — ADAM admission handshake · Dobius
- **Items:** X12
- **Depends on:** BUILD-001, BUILD-030, BUILD-007.
- **Files:** `M/agents/execution-gate.ts` (add ADAM check for terminal-agent launches: `dispatch_build` first); ADAM contract from `/Users/bayou/dobius/projects/ADAM/service/src/projects/handshake.ts:110-150` (read-only reference).
- **Test:** ADAM refusal codes (`unknown_project`, `project_not_managed`, `location_unverified`, `readiness_too_low`) block; ADAM offline → policy per Decision (recommended: block `dispatch_build`, allow manual).
- **Rollback:** revert; gate returns to pause-only.

---

## Phase 5 — Remote, phone, iMessage

### BUILD-032 — iMessage inbox integrity and terminal guard · Dobius
- **Bugs:** #12, #13, #14, #16, N12
- **Depends on:** BUILD-001.
- **Files:** `M/imessage-bridge/bridge-service.ts:31-40,181-274`; `M/imessage-bridge/imessage-send.ts:23,55`; `M/dobius-cli/dispatch-server.ts:130-142,206` (N12 = deep-report B11: `/tabSend` timeout, `/tabRead` limit). iMessage → terminal **stays**; guard = explicit target + foreground-process check at send time (`requireAgentStatus:'sendable'` exists in `M/runtime/rpc/methods/terminal.ts:922-938`, called through the runtime API, not edited).
- **Test:** throw after a command and before watermark → no retype; overlapping handles/group chats isolated; handle with `\` cannot alter AppleScript; idle-shell target refused, agent target accepted.
- **Rollback:** revert.

### BUILD-033 — Conductor approvals · Dobius
- **Bugs:** #9, #10, #11, #121, X3, X5
- **Depends on:** BUILD-032 (exact chat resolution), BUILD-007.
- **Files:** `M/voice-conductor/imessage-bridge.ts:47-60,118-135`; `M/voice-conductor/service.ts:27-28,42,113`; `M/voice-conductor/conductor-system-prompt.ts:61`; `M/dobius-cli/install-clis.ts:8-16,74-84`; `M/index.ts:1925` (Dobius wiring line).
- **Test:** concurrent asks, late/wrong-sender/unrelated replies rejected; missing handle visible; `dobius-confirm` missing/failed → deny; lane GIDs follow Settings.
- **Rollback:** revert.

### BUILD-034 — RPC authorization · Upstream
- **Bugs:** #21, #18
- **Depends on:** BUILD-003.
- **Files:** `M/ipc/runtime.ts:33-45`; `M/runtime/rpc/dispatcher.ts:45-80`; `M/runtime/runtime-rpc.ts:120-330,941-965`.
- **Test:** untrusted frame → denied; mobile token without explicit grant denied `terminal.send`, `git.push`, `worktree.rm`, `settings.update`; desktop flows still work.
- **Rollback:** revert.

### BUILD-035 — Remote session security · Upstream
- **Bugs:** #17, #19, #20, #22, X8, N11
- **Depends on:** BUILD-034, BUILD-016.
- **Files:** `M/runtime/runtime-rpc.ts:690-720,895-905,1072` (N11 = deep-report B10: PID-reuse orphan socket cleanup); `M/runtime/rpc/e2ee-channel.ts:9,61-63,153-216`; `M/runtime/rpc/ws-transport.ts:45-46,188-198`; `M/runtime/device-registry.ts:52-92`; `M/ipc/mobile.ts:143-158`; `M/agent-hooks/server.ts:1187`; `tls-certificate.ts` (X8).
- **Test:** captured hello/auth replay fails on a new connection; expired/consumed QR fails; 128 idle sockets evicted; constant-time compare tolerates bad lengths.
- **Rollback:** revert; protocol is versioned so old phones get a clear "update" error.

---

## Phase 6 — Voice

### BUILD-036 — Conductor run lifecycle · Dobius
- **Bugs:** #58, #59, #60, #61
- **Depends on:** BUILD-033, BUILD-022, BUILD-023.
- **Files:** `M/voice-conductor/conductor.ts:89-108,120-220`; `M/voice-conductor/agent-spawn.ts:60-92`; `M/voice-conductor/work-registry.ts:6`; `M/voice-conductor/conductor-system-prompt.ts:112`.
- **Test:** extend `conductor.test.ts`: rapid transcripts never overlap; stop tracks all owned runs; managed-field migration keeps user overrides; second spawn refused while one owned item is open.
- **Rollback:** revert.

### BUILD-037 — Jarvis renderer lifecycle · Dobius
- **Bugs:** #82, #83, #88, X7
- **Depends on:** —
- **Files:** `R/components/jarvis/use-jarvis-turn.ts:51,96,194,305`; `R/hooks/use-audio-capture.ts:286`; `R/components/jarvis/use-voice-agent.ts:49-86`; `OrbView` (X7).
- **Test:** re-render mid-capture does not tear down; stop during signed-URL/connect awaits closes the late session; no model → specific status.
- **Rollback:** revert.

### BUILD-038 — Jarvis main lifecycle · Dobius
- **Bugs:** #87, #89, #90, #91, #122-F9 (split row)
- **Depends on:** BUILD-019 (same `jarvis-ipc.ts`).
- **Files:** `M/jarvis/agent-context.ts:15,77-102`; `M/jarvis/jarvis-ipc.ts:31-41,204-211`; `M/jarvis/jarvis-target-window.ts:13`; `M/jarvis/elevenlabs-client.ts:75-95`; `M/jarvis/jarvis-service.ts:143`.
- **Test:** failed `--help` not cached; ⌘T with self-edit focused reaches main; TTS temp dirs removed on success/failure/cancel; partial playback not re-read; shortcut grab failure surfaced, `jarvisEnabled` not silently written false.
- **Rollback:** revert.

### BUILD-039 — Speech and dictation lifecycle · Upstream
- **Bugs:** #84, #85, #92, #123, #86 (verify-only)
- **Depends on:** —
- **Files:** `M/speech/openai-transcription-client.ts:50-86`; `R/hooks/use-audio-capture.ts:179` (engine half; coordinate with BUILD-037 which edits :286 — **sequential, not parallel**); `R/components/dictation/DictationController.tsx:231`, `use-hold-dictation-gesture.ts:181`; `M/speech/vps-transcription-client.ts:23`; `M/speech/stt-service.ts:39-124`. #86: write the worker lifecycle test the matrix asks for; reopen only if it fails.
- **Test:** never-resolving fetch times out; 10-minute boundary segments or stops visibly; theme change mid-hold keeps recording; custom `vpsSttEndpoint` reaches the request.
- **Rollback:** revert.

---

## Phase 7 — UI behavior

### BUILD-040 — Kanban UI truth · Dobius
- **Bugs:** #93, #95
- **Depends on:** BUILD-025.
- **Files:** `R/components/kanban/KanbanBoard.tsx:436,589`.
- **Test:** Done move opens an app dialog, cancel keeps column; empty board shows a finite completion value.
- **Rollback:** revert.

### BUILD-041 — Agents UI truth · Dobius
- **Bugs:** #98, #99, X6
- **Depends on:** BUILD-011, BUILD-023.
- **Files:** `R/components/agents/AgentLivePulse.tsx:45`; `R/components/agents-hub/AgentsOverview.tsx:133`; Command Center Generate button (X6; `R/components/command-center/`, exact file UNDETERMINED).
- **Test:** old summary labeled with age; two runs for one agent = 1 agent / 2 runs; Generate shows "not available".
- **Rollback:** revert.

### BUILD-042 — Automations UI truth · Upstream
- **Bugs:** #96, #97
- **Depends on:** BUILD-027.
- **Files:** `R/components/automations/AutomationsPage.tsx:1008-1066,1750-1820`.
- **Test:** each mutation rejection shows an error and resets pending state; theme change does not refetch.
- **Rollback:** revert.

---

## Phase 8 — Build and release

### BUILD-043 — One safe installer · Dobius (repo tooling)
- **Bugs:** #100, #103, #104, #105, #112
- **Depends on:** —
- **Files:** `build-and-install.sh:16-41`; `scripts/install-dobius-v2.sh:62-84` (retire: exits with a pointer to the gated script); `scripts/install-dobius-gated.sh:18-110` (lock first, stage, validate, swap, keep rollback copy outside `/Applications` and outside `dobius/dist`); `~/.claude/hooks/dobius-install-gate.sh:12,20` stays advisory (external file; edit only with Carson's OK).
- **Test:** shell test harness against fixture directories (never `/Applications`): copy/rename/validation failure keeps prior bundle; concurrent installers serialize.
- **Rollback:** revert; the old gated script is restored from git.

### BUILD-044 — Version, provenance, auto-bump · Dobius (repo tooling)
- **Bugs:** #102, #109, #110, N8, X2 + Carson's **automatic version bump on every build/install**
- **Depends on:** BUILD-043.
- **Files:** `scripts/install-dobius-gated.sh:25,44-51,80-92` (SemVer compare incl. prerelease; N8: missing version currently passes); `dobius/package.json:3`; `dobius/config/electron-builder.config.cjs` (`buildVersion`); provenance JSON gains `dirty`, `diffDigest`, `buildNumber`.
- **Test:** compare rc.1/rc.2/stable/patch both ways; missing version refused; dirty fixture recorded; two consecutive builds get increasing build numbers.
- **Rollback:** revert.

### BUILD-045 — Full build graph and toolchain · Dobius (repo tooling)
- **Bugs:** #101, #114
- **Depends on:** BUILD-043.
- **Files:** `build-and-install.sh:25-31` (use `pnpm run build:unpack` graph, `dobius/package.json:58-72`); artifact check for `Contents/Resources/app.asar.unpacked/out/cli/index.js` (ADAM `service/src/adapters/dobius.ts:99-130`); `.nvmrc` / engine check for Node 24 (`dobius/package.json` `engines.node: "24"`).
- **Test:** manifest check fails a fixture bundle missing `out/cli/index.js`; toolchain check prints active vs required Node.
- **Rollback:** revert.

### BUILD-046 — Updater policy · Upstream
- **Bugs:** #106, #107, #111
- **Depends on:** BUILD-044.
- **Files:** `M/updater.ts:948-956,1040,1338-1361`; `M/dobius-disconnect.ts:4`; `M/window/attach-main-window-services.ts:155-165`; `R/components/UpdateCard.tsx:127`; `dobius/config/dev-app-update.yml:1`.
- **Test:** truth table (enabled × disconnected) for startup/wake/timer/menu/download; disabled never reads "up to date".
- **Rollback:** revert.

---

## Phase 9 — Config and docs

### BUILD-047 — Settings truth (engine) · Upstream
- **Bugs:** #122 (F8 Markdown Review Notes, F11 Share usage data), X9
- **Depends on:** —
- **Files:** `M/telemetry/client.ts:48,127`; `R/components/settings/PrivacyPane.tsx`; editor review-notes wiring `R/components/editor/useRichMarkdownReviewController.ts` (exact toggle consumer UNDETERMINED); orphans in `S/constants.ts`; `M/codex-cli/command.ts:218` (X9 env-over-setting precedence).
- **Test:** each toggle has an observable effect or an explicit "unavailable" state.
- **Rollback:** revert.

### BUILD-048 — Docs and agent instructions · Dobius (docs)
- **Bugs:** #108, #113, #116, #117 (verify-only)
- **Depends on:** BUILD-043, BUILD-044, BUILD-045.
- **Files:** `RELEASING.md`; `CLAUDE.md`, `.claude/CLAUDE.md` (describe V1, `npm run`, "MUST rm -rf"); `dobius/AGENTS.md:1-17` (wrong repo path `/Users/bayou/Projects (Code)/dobius-plus`); `~/.claude/skills/dobius-build-install/SKILL.md` (external, Carson's OK). #117: `~/.claude/SKILLS-HOOKS-AGENTS.md` already says "no `ensureLearnHooks()` exists … verified 2026-09-24" (seen this session) → verify and close.
- **Test:** every command/path in the docs resolves in the repo (scripted grep check).
- **Rollback:** revert.

### BUILD-049 — Lint debt · Dobius
- **Bugs:** #115
- **Depends on:** BUILD-048; runs last among code builds so it does not collide with feature files.
- **Files:** per the Phase 0 lint report (mostly `R/components/communications/`). No `max-lines` disables (`dobius/AGENTS.md`).
- **Test:** `pnpm --dir dobius run lint` exit 0 or a checked-in, shrinking allowlist agreed with Carson.
- **Rollback:** revert per sub-commit.

### BUILD-050 — Generated per-session WORKSPACE.md · Dobius (Carson feature request)
- **Items:** WORKSPACE.md requirement (see `PHASES.md` Phase 9).
- **Depends on:** BUILD-031 (ADAM context pack), BUILD-048.
- **Rollback:** revert; generated files are gitignored/local.

---

## Split rows (compound canonical rows that cross layers)

| Row | Primary owner | Split part | Why |
|---|---|---|---|
| #25 | BUILD-017 (Upstream: `persistence.ts`, `speech/openai-api-key-store.ts`) | BUILD-018 carries the communications provider key store | engine and Dobius owners of the same fail-open pattern |
| #122 | BUILD-047 (Upstream: telemetry toggle, Markdown Review Notes) | BUILD-038 carries #122-F9, Jarvis switch silently off (`M/jarvis/jarvis-ipc.ts:204-211`) | F8/F11 are engine UI, F9 is Jarvis |

## Verify-only / closed rows

- **#8** (Refuted by Run A; agreed): BUILD-008 fixes the misleading comment in `custom-agents.ts:61-64` and adds a regression test that omitted RPC caps reach runner defaults. The uncapped Codex path is #5 (BUILD-022).
- **#86** (Refuted by Run A): BUILD-039 writes the worker lifecycle test; the bug is reopened only if that test fails.
- **#115** (Could not locate a current count): Phase 0 captures the real lint report; BUILD-049 owns the fix.
- **#117** (Already corrected outside the repo): BUILD-048 verifies the note and closes it.
- **#114** (Could not locate the active Node version in Run A): Phase 0 records `node --version`; BUILD-045 owns the pin/check.

## N-items (new defects outside the 123)

| ID | Defect (evidence) | Disposition |
|---|---|---|
| N1 | `custom-agents.ts:167` RPC `agent.run`: only `channel` gets `dontAsk`; other sources get no `canUseTool` → silent denies | BUILD-008 |
| N2 | iMessage `@Agent` runs use sessionKey `'default'` (`agent-channel-service.ts:104-150`) | BUILD-023 |
| N3 | Conductor agent gets `CHANNEL_AGENT_BASELINE_TOOLS` unioned in (`agent-runner.ts:344-347`, `conductor.ts:22-30,101`) | BUILD-007 |
| N4 | Journal dir differs before/after `app.isReady()` (`agent-run-event-journal.ts:24-28`) | BUILD-029 |
| N5 | Journal replay fired before `store` at launch (`index.ts:1630-1632`) | BUILD-029 |
| N6 | `restoreFromBackup` writes primary non-atomically (`persistence.ts:2795-2800`) | BUILD-013 |
| N7 | Remote-host relay runs agent binaries for any client of its unix socket (`src/relay/relay.ts:47-73`, `agent-exec-handler.ts`) | **Deferred**: socket is owner-only (umask 0o177), so only the same OS user can reach it, and that user can already run binaries. Revisit when the SSH threat model is written (Decision). |
| N8 | Gated installer treats a missing version as pass (`install-dobius-gated.sh:44-51`) | BUILD-044 |
| N9 | Kanban `inFlight` leak when the claim update rejects (`board-dispatch.ts:121-122,174`) | BUILD-025 |
| N10 | Phone WebSocket always on, no off switch (`index.ts:2097`) | BUILD-003 |
| N11 | Deep-report B10: PID-reuse orphan socket cleanup (`runtime-rpc.ts:1072`) | BUILD-035 |
| N12 | Deep-report B11: `/tabSend` timeout, `/tabRead` limit (`dispatch-server.ts:140,206`) | BUILD-032 |
| N13 | Automations scheduler and `orchestration.run` ignore "Pause crew" (ARCHITECTURE-MAP §5.1 rows 5, 13) | BUILD-002 |

## X-items

| ID | Disposition |
|---|---|
| X1 self-edit root | BUILD-006 |
| X2 provenance dirty tree | BUILD-044 |
| X3 stale "fails loudly" comment | BUILD-033 |
| X4 agent form bypass text | BUILD-008 |
| X5 `dobius-ask` "Ask Sam" wording | BUILD-033 |
| X6 Command Center Generate | BUILD-041 |
| X7 legacy OrbView capture | BUILD-037 |
| X8 TLS dead code, CLI installer overlap, dead `orb:close`, QR host | BUILD-035 (the CLI-installer overlap sub-item moves with BUILD-043 only if it touches `scripts/`; otherwise stays here) |
| X9 orphan settings, env-over-setting CLI path | BUILD-047 |
| X10 large synchronous main-thread writes | **Deferred**: performance, not correctness; Run A marks sizes UNVERIFIED; needs a measured baseline (`bench:startup`) after Phase 2 before touching engine usage stores. |
| X11 relay.db / event archive retention | **Deferred**: retention deletes user data; needs Carson's retention policy (Decision). Revisit after Phase 10. |
| X12 ADAM handshake | BUILD-031 |

## Coverage

BUG COVERAGE: 123 / 123 (each ID has one owning build; #25 and #122 have one declared split part each).

Owner map: 1-2→001 · 3-4→005 · 5→022 · 6-7→007 · 8→008 · 9-11→033 · 12-14→032 · 15→018 · 16→032 · 17→035 · 18→034 · 19-20→035 · 21→034 · 22→035 · 23→005 · 24→018 · 25→017 · 26-27→006 · 28→010 · 29-30→009 · 31-33→013 · 34-35→016 · 36-37→012 · 38-39→019 · 40-41→011 · 42→023 · 43-45→024 · 46→009 · 47→010 · 48→021 · 49→020 · 50→021 · 51→020 · 52→015 · 53→014 · 54→028 · 55→022 · 56-57→023 · 58-61→036 · 62-65→026 · 66→024 · 67→022 · 68-69→027 · 70→022 · 71→027 · 72→028 · 73→007 · 74-75→008 · 76→005 · 77→023 · 78-80→029 · 81→030 · 82-83→037 · 84-86→039 · 87→038 · 88→037 · 89-91→038 · 92→039 · 93→040 · 94→025 · 95→040 · 96-97→042 · 98-99→041 · 100→043 · 101→045 · 102→044 · 103-105→043 · 106-107→046 · 108→048 · 109-110→044 · 111→046 · 112→043 · 113→048 · 114→045 · 115→049 · 116-117→048 · 118→030 · 119→004 · 120→028 · 121→033 · 122→047 · 123→039.
