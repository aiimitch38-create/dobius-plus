# Dobius+ V2 — Branch plan

Date: 2026-09-24.

## Scheme

- **Integration branch:** `stabilize/iris-20260923`. Every build branch starts from its current tip and merges back into it.
- **One branch per build:** `stabilize/NNN-<slug>` (three digits, matching the build number, so `ls` sorts in execution order). The brief's `NN` form is kept, widened to three digits because there are 50 builds.
- **One worktree per branch:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus/.claude/worktrees/NNN-<slug>`. Create with `git worktree add -b stabilize/NNN-<slug> .claude/worktrees/NNN-<slug> stabilize/iris-20260923`. Never `git checkout` a build branch inside a shared checkout (NOTES 2026-08-25). Check free disk first (`df -h`), per `learned-enospc-silent-build`.
- **Never** rebase or force-push `stabilize/iris-20260923`. A build branch may rebase onto the integration tip before its merge.
- **Merge** is a human action (Carson clicks merge, house rule). Squash is not used, so each fix commit stays revertible on its own.

## Merge criteria (every branch)

1. Only the files listed for the build changed (`git diff --stat stabilize/iris-20260923...`). Anything else is explained in the PR.
2. Layer rule holds: an `Upstream` branch touches no Dobius-layer file, and a `Dobius` branch touches no engine file.
3. `pnpm --dir dobius run typecheck` exit 0.
4. `pnpm --dir dobius test` exit 0, with no new failures against the Phase 0 failing-test list.
5. The build's named tests exist and fail on the integration tip without the fix (shown in the PR description).
6. Touched files pass `oxlint`; pre-commit hooks ran (no `--no-verify`).
7. `code-reviewer` subagent + `review-audit` findings resolved; the reviewer checklist in the build spec is ticked.
8. `BUILD-LOG.md` entry appended.
9. Installed only through the gated installer, and only when a gate needs it.

## Branches

| Branch | Bugs | Depends on | Expected files | Tests | Lane |
|---|---|---|---|---|---|
| `stabilize/001-global-execution-gate` | 1, 2 | — | see `BUILD-001.md` | config-store, gate, runner-admission, ledger, asana, tool-server, channel, bridge, board | A |
| `stabilize/002-engine-producer-admission` | N13 | 001 | `M/automations/service.ts`, `M/runtime/rpc/methods/orchestration-gates.ts` | service-admission, orchestration gate | E-orch |
| `stabilize/003-remote-listener-switch` | N10 | — | `M/index.ts:2090-2102`, `M/runtime/runtime-rpc.ts`, `S/types.ts`, `S/constants.ts` | runtime-rpc switch | E-rpc |
| `stabilize/004-execution-state-ui` | 119 | 001 | `M/ipc/agents.ts`, `P/index.ts`, `AsanaPane.tsx`, `AgentsPageHeader.tsx`, `AgentsPage.tsx` | component tests | A |
| `stabilize/005-protected-path-rails` | 3, 4, 23, 76 | — | `agent-hard-rails.ts`, `agent-runner-environment.ts` | hard-rails, environment | R |
| `stabilize/006-self-edit-path-policy` | 26, 27, X1 | — | `M/jarvis/self-edit.ts`, `M/jarvis/jarvis-ipc.ts` | self-edit | J |
| `stabilize/007-run-capability-profiles` | 6, 7, 73, N3 | 001 | runner, dobius-tools, tool server/handlers, `conductor.ts` | tool-server | A |
| `stabilize/008-headless-permissions` | 74, 75, N1, 8v, X4 | 007 | runner, decision queue, `custom-agents.ts`, agent form | runner, SDK fixture | A |
| `stabilize/009-safe-json-store` | 29, 30, 46 | 001 | new `M/storage/safe-json-file.ts` + 8 stores | table-driven faults | A |
| `stabilize/010-kanban-store-integrity` | 28, 47 | 009 | `M/vertex/vertex-task-store.ts` | vertex store | K |
| `stabilize/011-agent-identity-save` | 40, 41 | 009 | `AgentsPage.tsx`, `agent-identity-files.ts` | AgentsPage | U |
| `stabilize/012-comms-identity-blobs` | 36, 37 | 009, 017 | comms identity stores, blob store | identity, blob | C |
| `stabilize/013-primary-store-recovery` | 31, 32, 33, N6 | — | `M/persistence.ts` | persistence | E-pers |
| `stabilize/014-data-root` | 53 | 013, 003 | `M/persistence.ts`, `M/index.ts:584,2089`, `M/ipc/runtime-environments.ts` | root fixtures | E-pers |
| `stabilize/015-legacy-v1-isolation` | 52 | 014 | `M/migrate-legacy-dobius-config.ts`, `electron/config-manager.js`, `electron/main.js` | V1/V2 fixture | V1 |
| `stabilize/016-remote-identity-persistence` | 34, 35 | 009 | `e2ee-keypair.ts`, `device-registry.ts` | keypair, registry | E-rpc |
| `stabilize/017-secret-storage-engine` | 25 | 013 | `M/persistence.ts:224-233`, `M/speech/openai-api-key-store.ts` | safeStorage fault | E-pers |
| `stabilize/018-dobius-secrets` | 24, 15, 25c | 017, 009 | `elevenlabs-client.ts`, new key store, `bridge-config.ts`, comms provider key store | serialized fixtures | J/C |
| `stabilize/019-self-edit-concurrency` | 38, 39 | 006 | `self-edit.ts`, `jarvis-ipc.ts` | self-edit | J |
| `stabilize/020-tmp-hygiene` | 49, 51 | — | `M/stats/collector.ts`, `M/agent-hooks/server.ts`, `M/browser/browser-session-registry.ts` | fault tests | E-misc |
| `stabilize/021-daemon-history` | 48, 50 | — | `M/daemon/history-manager.ts`, `daemon-init.ts` | daemon | E-daemon |
| `stabilize/022-codex-parity` | 5, 55, 67, 70 | 008 | runner, `codex-agent-execution.ts`, heartbeat | codex execution | A |
| `stabilize/023-run-sessions-history` | 42, 56, 57, 77, N2 | 022, 009 | runner, agents-store, runs-store, channel service | runner/store | A |
| `stabilize/024-producer-reconciliation` | 43, 44, 45, 66 | 009, 022 | ledger, asana auto mode, heartbeat | ledger/heartbeat | A |
| `stabilize/025-kanban-dispatch-recovery` | 94, N9 | 010, 023 | `board-dispatch.ts`, `vertex-task-store.ts` | board | K |
| `stabilize/026-orchestration-coordinator` | 62–65 | 002 | orchestration gates/db/coordinator | orchestration | E-orch |
| `stabilize/027-automations-lifecycle` | 68, 69, 71 | 002 | `M/automations/service.ts`, orchestration-gates | automations | E-orch |
| `stabilize/028-asana-intake` | 54, 72, 120 | 024 | `M/asana/*` | fixtures | A |
| `stabilize/029-adam-event-delivery` | 78, 79, 80, N4, N5 | — | `agent-run-event-journal.ts`, `M/index.ts:1630-1632` | journal | ADAM |
| `stabilize/030-adam-registry` | 81, 118 | 029, 019 | `adam-client.ts`, journal, `self-edit.ts:39-41` | registry | ADAM |
| `stabilize/031-adam-admission` | X12 | 001, 007, 030 | `execution-gate.ts` | refusal codes | A |
| `stabilize/032-imessage-inbox` | 12, 13, 14, 16, N12 | 001 | bridge-service, imessage-send, dispatch-server | bridge | M |
| `stabilize/033-conductor-approvals` | 9, 10, 11, 121, X3, X5 | 032, 007 | conductor bridge/service/prompt, install-clis, `M/index.ts:1925` | conductor bridge | M |
| `stabilize/034-rpc-authorization` | 18, 21 | 003 | `ipc/runtime.ts`, dispatcher, runtime-rpc | dispatcher | E-rpc |
| `stabilize/035-remote-session-security` | 17, 19, 20, 22, X8, N11 | 034, 016 | runtime-rpc, e2ee-channel, ws-transport, device-registry, `ipc/mobile.ts`, hook server compare | transport | E-rpc |
| `stabilize/036-conductor-lifecycle` | 58–61 | 033, 022, 023 | conductor, agent-spawn, work-registry, prompt | conductor | M |
| `stabilize/037-jarvis-renderer` | 82, 83, 88, X7 | — | jarvis hooks, use-audio-capture, OrbView | hooks | J-R |
| `stabilize/038-jarvis-main` | 87, 89, 90, 91, 122-F9 | 019 | agent-context, jarvis-ipc, target-window, elevenlabs-client, jarvis-service | jarvis | J |
| `stabilize/039-speech-dictation` | 84, 85, 86v, 92, 123 | 037 (file) | `M/speech/*`, use-audio-capture, dictation | speech | J-R |
| `stabilize/040-kanban-ui` | 93, 95 | 025 | `KanbanBoard.tsx` | component | K |
| `stabilize/041-agents-ui` | 98, 99, X6 | 011, 023 | AgentLivePulse, AgentsOverview, command-center | component | U |
| `stabilize/042-automations-ui` | 96, 97 | 027 | `AutomationsPage.tsx` | component | E-orch |
| `stabilize/043-single-safe-installer` | 100, 103, 104, 105, 112 | — | `build-and-install.sh`, `scripts/install-*.sh` | shell harness | T |
| `stabilize/044-version-provenance-bump` | 102, 109, 110, N8, X2 | 043 | gated installer, `dobius/package.json`, builder config | script tests | T |
| `stabilize/045-full-build-graph` | 101, 114 | 043 | `build-and-install.sh`, toolchain check | manifest | T |
| `stabilize/046-updater-policy` | 106, 107, 111 | 044 | updater, disconnect, attach services, UpdateCard, dev-app-update.yml | truth table | E-upd |
| `stabilize/047-settings-truth-engine` | 122, X9 | — | telemetry, PrivacyPane, editor review notes, constants, `codex-cli/command.ts` | settings | E-misc |
| `stabilize/048-docs-instructions` | 108, 113, 116, 117v | 043, 044, 045 | `RELEASING.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `dobius/AGENTS.md`, skill | path check | T |
| `stabilize/049-lint-debt` | 115 | 048 | per lint report | lint | last |
| `stabilize/050-workspace-md` | WORKSPACE.md | 031, 048 | new generator | generator | last |

## Parallel lanes

A **lane** is a set of builds that must run one after another because they share files. Different lanes can run at the same time in separate worktrees once their listed dependencies are merged.

| Lane | Builds (serial inside the lane) | Shared hot files |
|---|---|---|
| A — agents core | 001 → 004 → 007 → 008 → 009 → 022 → 023 → 024 → 028 → 031 | `M/agents/agent-runner.ts`, `dobius-tool-handlers.ts`, `asana-*`, `agents-store.ts`, `agent-runs-store.ts` |
| R — rails | 005 | `agent-hard-rails.ts`, `agent-runner-environment.ts` |
| J — Jarvis main | 006 → 019 → 038, then ADAM 030 after 019 | `M/jarvis/self-edit.ts`, `jarvis-ipc.ts` |
| J-R — voice renderer + speech | 037 → 039 | `R/hooks/use-audio-capture.ts` |
| K — Kanban | 010 → 025 → 040 | `vertex-task-store.ts`, `board-dispatch.ts`, `KanbanBoard.tsx` |
| U — agents UI | 011 → 041 | `AgentsPage.tsx` (also touched by 004: run 004 first) |
| C — communications | 012 (after 017), 018's comms part | comms identity/key stores |
| M — messaging | 032 → 033 → 036 | `bridge-service.ts` (after 001), `voice-conductor/*` |
| ADAM | 029 → 030 | `agent-run-event-journal.ts` |
| E-pers — engine persistence | 013 → 014 → 017 | `M/persistence.ts` |
| E-rpc — engine remote | 003 → 016 → 034 → 035 | `M/runtime/runtime-rpc.ts`, `device-registry.ts` |
| E-orch — engine orchestration/automations | 002 → 026 → 027 → 042 | `orchestration-gates.ts`, `automations/service.ts` |
| E-daemon | 021 | `M/daemon/*` |
| E-misc | 020, 047 | disjoint small engine files |
| E-upd | 046 (after 044) | `M/updater.ts` |
| T — tooling/docs | 043 → 044 → 045 → 048 | `scripts/`, `build-and-install.sh`, docs |
| V1 | 015 (after 014) | `electron/`, `migrate-legacy-dobius-config.ts` |
| last | 049, 050 | whole tree |

**Can run in parallel** (disjoint files, deps satisfied): lanes R, J, J-R, E-pers, E-daemon, E-misc, T and ADAM from day one alongside lane A's BUILD-001; lane E-rpc's 003 alongside 001; lane K after 009; lane M after 001.

**Must not run in parallel:**
- Anything in lane A with anything else in lane A (`agent-runner.ts` is edited by 001, 007, 008, 022, 023).
- 004 and 011 (`AgentsPage.tsx`).
- 001 and 032 (`bridge-service.ts`); 001 and 025 (`board-dispatch.ts`).
- 003, 014, 029, 033 all touch `M/index.ts`: merge one at a time and rebase the next.
- 013, 014, 017 (`M/persistence.ts`).
- 003, 034, 035 (`runtime-rpc.ts`); 016 and 035 (`device-registry.ts`).
- 006, 019, 030, 038 (`M/jarvis/self-edit.ts`, `jarvis-ipc.ts`).
- 037 and 039 (`use-audio-capture.ts`).
- 018 and 038 (`M/jarvis/elevenlabs-client.ts`); 007 and 036 (`M/voice-conductor/conductor.ts`).
- 002, 026, 027 (`orchestration-gates.ts`, `automations/service.ts`).
- 043, 044, 045 (installer scripts).
- 049 with anything (tree-wide lint edits).

## Merge order

Follow build numbers inside each lane. Across lanes, merge in this global order (a later item waits only if it depends on an earlier one):

1. 001, 003, 005, 006, 013, 020, 021, 043, 029, 037, 047
2. 002, 004, 007, 014, 017, 019, 044, 045
3. 008, 009, 015, 026, 027, 030, 032, 034, 039, 046
4. 010, 011, 012, 016, 018, 022, 033
5. 023, 024, 035
6. 025, 028, 031, 036, 038
7. 040, 041, 042, 048
8. 049, 050

Gate installs happen at the end of the group that completes that gate's list (`SAFETY-GATES.md`).
