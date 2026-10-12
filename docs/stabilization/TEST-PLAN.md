# Dobius+ V2 — Test plan

Date: 2026-09-24. Planning only; nothing here was run by Run B.

## Real test setup (read in source 09-24)

- **Unit + integration:** vitest via `pnpm --dir dobius test` → `node config/scripts/ensure-native-runtime.mjs --runtime=node && vitest run --config config/vitest.config.ts` (`dobius/package.json` `scripts.test`). Includes `src/**/*.test.ts`, `src/**/*.test.tsx`, `src/**/*.test.mjs`, `config/scripts/**/*.test.mjs`, `tests/e2e/**/*.unit.test.ts`; environment `node`; `testTimeout` 30 s (`dobius/config/vitest.config.ts`).
- **Focused run:** `npx vitest run --config config/vitest.config.ts <paths>` from `dobius/`.
- **Typecheck:** `pnpm --dir dobius run typecheck` (tsgo, three configs). Bare `npx tsgo --noEmit` does not work here (skill `learned-dobius-typecheck-configs`).
- **E2E:** Playwright, `pnpm --dir dobius run test:e2e` → `tests/playwright.config.ts`, project `electron-headless`, `testDir: ./e2e`; helpers in `dobius/tests/e2e/helpers/` (`dobius-app.ts`, `dobius-restart.ts`, `agent-hook-endpoint.ts`, `e2e-completed-onboarding-profile.ts`). Isolation through `DOBIUS_E2E_USER_DATA_DIR` (`M/index.ts:2070`). Existing specs to extend: `agent-session-quit-resume.spec.ts`, `agent-session-live-force-exit-resume.spec.ts`, `automation-hidden-terminal-first-mount.spec.ts`, `mobile-banner.spec.ts`.
- **Mocking patterns already in the repo:** `vi.mock('electron', …)` with a `mkdtemp` userData (`M/agents/asana-dispatch-ledger.test.ts:6-28`); sibling-module mocks (`M/agents/agent-tools/dobius-tool-server.test.ts:13-62`); exported `…Internals` objects for pure logic (`R/components/kanban/board-dispatch.ts:201`).

## Ground rules

- Tests never touch Carson's real userData, `~/.dobius`, `/Applications`, chat.db, Asana, ADAM, ElevenLabs or OpenAI. Every path is a temp dir; every network client is a fake.
- Fixtures are synthetic. Never copy files from the Phase 0 snapshot into the repo (they hold secrets). Fixture dir: `dobius/tests/fixtures/stabilization/` (new).
- Each build's new tests must **fail on the integration tip without the fix** and pass with it. The PR shows both runs.
- A test that needs root, Windows ACLs or a real Electron window says so and skips cleanly elsewhere.

---

## Rung 1 — Unit

Pure functions and single modules with their neighbours mocked. Owned by each build (file names are in `EXECUTION-ORDER.md` and `BUILD-001.md`). Required per cluster:

| Cluster | Unit focus |
|---|---|
| Execution gate (001, 002, 004) | control-state classification; gate decision table; runner entry and post-await checks; each producer blocked |
| Path rails (005, 006) | canonicalization table (`~`, `$HOME`, `${HOME}`, absolute, symlink, mid-command); force-push parser; self-edit canonical parents |
| Capability profiles (007, 008) | exact tool set per source; `dispatch_build` authorization; headless permission outcomes |
| Safe persistence (009–021) | load status per failure; zero writes on failed load; atomic save; quarantine; fail-closed encryption |
| Run lifecycle (022–027) | exactly-once finalizer; slot release per outcome; timestamp comparison; escalation binding |
| Messaging (032, 033) | exact chat match; action-bound approval parser; AppleScript escaping; watermark coupling |
| Remote (003, 034, 035) | per-method grants; handshake replay; QR expiry; constant-time compare |
| Voice (036–039) | generation tokens; timeouts; temp cleanup; segmenting |
| Release (043–046) | SemVer compare incl. prerelease; provenance fields; build-number monotonicity; update policy truth table |

## Rung 2 — Integration

Several real modules together, with only the outer edges faked (SDK `query`, `child_process.spawn`, `fetch`, `electron.app`, SQLite on a temp file).

1. **Admission end to end (after 001, 002):** real `agents-config-store` + gate + runner + heartbeat tick + Asana tick + tool handler + bridge `dispatchCommand`, with the SDK faked. Pause, then fire every producer; assert zero `query` calls and zero spawns.
2. **Store round trip (after 009–018):** write → kill (reset modules) → reload for every inventoried store in ARCHITECTURE-MAP §2.2.
3. **Run lifecycle (after 022–025):** Claude and Codex fakes through success, error, cancel, budget stop; assert slots, Asana claim, board card and conductor state.
4. **Orchestration + automations (after 026, 027):** real `orchestration/db.ts` on a temp SQLite file; restart simulation; completion race.
5. **ADAM delivery (after 029–031):** local fake HTTP server that goes offline/online; cursor file persists across module reloads.
6. **iMessage (after 032, 033):** a temp SQLite file with the `message`/`handle`/`chat`/`chat_message_join` shape from `M/imessage-bridge/bridge-service.ts:31-40`; fake `sendImessage`; fake terminal dispatcher.
7. **Remote (after 034, 035):** in-process `DobiusRuntimeRpcServer` on port 0 with a scripted WS client.
8. **Installer (after 043–045):** shell harness that runs the gated installer against fixture `src.app`/`dest` directories (never `/Applications`) with injected failures.

## Rung 3 — Failure injection

Each case names the builds it proves. Mechanisms: temp dirs + `chmod`; `vi.spyOn(fs, …)` to throw `EACCES`/`ENOSPC`/`EXDEV` at chosen calls; module reset to simulate a crash between two writes; fake child/SDK/HTTP clients.

| ID | Scenario | How to inject | Expected (all fail closed, nothing silently lost) | Builds |
|---|---|---|---|---|
| F1 | **Corrupt, partial and missing control/config files** | `agents-config.json` = `{`, `""`, `{"agentsPaused":"yes"}`, truncated half file, missing | corrupt/partial/wrong type → blocked, bytes unchanged, UI shows path; missing → first-use default | 001, 004 |
| F2 | **ADAM offline** | fake ADAM server refuses/timeouts; token file missing | gate unaffected (001); events queue with visible health (029); admission policy per Decision (031); no launch-time stall (N5) | 001, 029, 030, 031 |
| F3 | **Bad file permissions** | `chmod 000` on `agents-config.json`, stores, userData dir; umask 022 for new files | read denial = unreadable (never empty); write denial reported; `imessage-bridge.json` ends 0600 | 001, 009, 018 |
| F4 | **Corrupt, partial and missing store files** | each store in ARCHITECTURE-MAP §2.2: malformed JSON, half-written file, zero bytes, missing | zero writes during load; quarantine copy; recovery state; missing → empty is allowed | 009, 010, 011, 012, 016 |
| F5 | **Bad permissions on data files** | EACCES on read and on write, per store; read-only userData | no overwrite; write failure surfaced; pairings and identity intact | 009, 013, 016, 017 |
| F6 | **Interrupted and failed writes** | throw between `writeFileSync(tmp)` and `renameSync`; ENOSPC mid-write; rename EXDEV | previous primary valid; no owned tmp left; blob/meta never "complete" when partial | 009, 012, 020, 021 |
| F7 | **Concurrent writers** | two saves interleaved with `await` barriers; async rotation vs sync quit flush | final file equals one writer's full state; five backup generations consistent | 009, 013 |
| F8 | **Crash mid-run** | persist a `running` run / `claimed` ledger record / `in-progress` card / `running` coordinator row / `dispatching` automation, then reload modules | startup reconciliation converts each to a truthful terminal or retryable state; no double launch; no 30-day skip | 023, 024, 025, 026, 027 |
| F9 | **Codex missing from PATH** | fake `spawn` emits `ENOENT`; stdin emits `EPIPE` | one failed run, slot released, no uncaught stream error | 022 |
| F10 | **Claude failure** | SDK fake throws on start; stream throws mid-way; EOF without result; budget exceeded; resume failure | exactly one terminal state; channel/phone/conductor always get a reply; conductor pointer not clobbered | 022, 023, 036 |
| F11 | **Phone replay** | capture `e2ee_hello` + `e2ee_auth` frames, replay on a new socket; replay an expired/consumed QR; 128 idle sockets | replay rejected; expired QR rejected; idle sockets evicted; legit pairing works | 035 (and 003 off switch) |
| F12 | **Duplicate events** | same chat.db row twice; overlapping handle chats; two automation completion signals; Asana duplicate across pages; duplicate journal event ids | one terminal send per message; one notification; one triage; ADAM dedupes by event id | 032, 027, 028, 029 |
| F13 | **Backup corruption** | corrupt `.bak.0`, valid `.bak.3`; all backups corrupt; defaults-only primary | recovery picks newest valid; never rotates defaults over good backups; all-corrupt → recovery screen, originals preserved | 013 |
| F14 | **Pause flips mid-await** | deferred `prepareClaudeLaunch`, toggle pause, resolve | run refused, reservation released | 001 |

Also, from the Phase 0 snapshot (never committed): after Phase 2, run the new build's stores in **read-only mode** against a *copy* of the snapshot in a temp dir and assert every file loads `ok`. This proves the new loaders accept Carson's real data shapes without writing.

## Rung 4 — E2E (Playwright, `electron-headless`)

Run only with Carson present, on an isolated `DOBIUS_E2E_USER_DATA_DIR`, after the build is typecheck/vitest green. No paid calls: agents in E2E use a fake provider or a zero-budget stub.

| Spec (new unless noted) | Proves | Gate |
|---|---|---|
| `tests/e2e/stabilization-pause-gate.spec.ts` | seeded `agents-config.json` corrupt → Agents page shows blocked state; Kanban card in To Do stays unclaimed; manual Run still starts | A |
| `tests/e2e/stabilization-corrupt-stores.spec.ts` | seeded corrupt runs/board/agents files → app launches, shows recovery state, files byte-identical after quit | A |
| extend `agent-session-quit-resume.spec.ts` | meta.json atomic write keeps cold restore after forced quit | A (021) |
| `tests/e2e/stabilization-listener-off.spec.ts` | listener switch off → no TCP listener on the WS port | A (003) |
| extend `automation-hidden-terminal-first-mount.spec.ts` | paused → scheduled automation recorded as skipped, no terminal | A (002) |
| `tests/e2e/stabilization-kanban-recovery.spec.ts` | kill app mid board run → card converges after relaunch | C |
| extend `mobile-banner.spec.ts` + new pairing spec | QR expiry and re-pair flow | E |

## Per-build minimum

1. `pnpm --dir dobius run typecheck` exit 0.
2. Focused vitest on the build's directories, then full `pnpm --dir dobius test`, compared with the Phase 0 failing list.
3. The build's F-cases from the table above.
4. `oxlint` on touched files.

## Per-gate minimum

- Integration items relevant to the gate.
- All F-cases whose builds are in the gate's list.
- The gate's E2E rows.
- A gated install and Carson's manual checklist (e.g. `BUILD-001.md` §5 for Gate A).

## Phase 10 full regression

Full vitest, full typecheck, lint (after 049), all F-cases, all E2E rows, `pnpm --dir dobius run build:unpack` from a clean `out/`, a gated install with provenance check, then gate-by-gate re-enable with a 24-hour watch per gate.
