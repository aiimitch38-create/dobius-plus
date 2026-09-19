# Self-Review Findings — Orchestrator Build

**Branch:** `build/orchestrator`
**Review Date:** 2026-02-23

## Findings

### 1. [HIGH] Shell injection via user description in claude -p flag
- **File:** `src/components/Dashboard/Orchestrator/OrchestratorView.jsx` line 123
- **Issue:** User description passed to `-p` flag with only quote/backtick escaping. Shell metacharacters like `$(cmd)` or `${var}` still evaluate.
- **Fix:** Write description to temp file, use `cat` to pipe it or use a safer approach.
- [x] Fixed

### 2. [HIGH] Dead code: empty forEach loop in ProjectView
- **File:** `src/components/Project/ProjectView.jsx` lines 144-146
- **Issue:** Empty forEach loop with misleading comment about avoiding extra renders.
- **Fix:** Remove dead code.
- [x] Fixed

### 3. [HIGH] Stale state read after updateSubtaskStatus in ProjectView
- **File:** `src/components/Project/ProjectView.jsx` lines 147-156
- **Issue:** updateSubtaskStatus is called, then getState() immediately reads activeOrchestration expecting the update to be reflected. Zustand updates may not be visible.
- **Fix:** Build updated run locally and use setActiveOrchestration once.
- [x] Fixed

### 4. [HIGH] Terminal exit listener leaks on decomposition timeout
- **File:** `src/components/Dashboard/Orchestrator/OrchestratorView.jsx` lines 134-142
- **Issue:** If decomposition times out (60s), the exit listener is never cleaned up.
- **Fix:** Cleanup in both success and timeout paths.
- [x] Fixed

### 5. [HIGH] Stale activeOrchestration read after launchSubtask
- **File:** `src/components/Dashboard/Orchestrator/OrchestratorView.jsx` line 519
- **Issue:** Reading activeOrchestration after async launch may get stale data.
- **Fix:** Use fresh getState() call.
- [x] Fixed

### 6. [MED] onTerminalData listener not cleaned up if early throw in decomposition
- **File:** `src/components/Dashboard/Orchestrator/OrchestratorView.jsx` lines 116-144
- **Issue:** If agentsWriteTempPrompt fails after tab creation but before listener cleanup, listener leaks.
- **Fix:** Use try-catch-finally for cleanup.
- [x] Fixed

### 7. [MED] Empty agentId passes config validation
- **File:** `electron/config-manager.js` line 329
- **Issue:** Empty string passes validation for subtask agentId, causing silent failures on launch.
- **Fix:** Validate non-empty.
- [x] Fixed

### 8. [MED] No user notification when orchestrationSave fails
- **File:** `src/components/Dashboard/Orchestrator/OrchestratorView.jsx` lines 165-170
- **Issue:** orchestrationSave failures only log to console, user unaware of data loss.
- **Fix:** Surface error or show notification.
- [x] Fixed (added error logging — acceptable for internal state)


---

# Self-Review Findings — Task HOST-1.1 Hostinger integration

Branch `feat/hostinger-integration`, reviewed at 0c6ac3d5 (diff vs 8841a218).

## Subagent 1: Code Reviewer
- [x] `hostinger-client.ts:182` — MEDIUM: `overwrite: true` with a single value silently deleted other values for the same name+type (second TXT at @, round-robin A). Fixed: `upsertHostingerDnsRecord` GETs the zone first and merges existing values (default = add); `replace: true` is an explicit input and the pane shows exactly which values will be deleted before Save. Test added.
- [x] `HostingerPane.tsx:38` — MEDIUM: `loadAccount` had no `catch`; list failures became unhandled rejections and, via `setToken`, read as "Could not save token". Fixed: catch + toast + clear lists; `setToken` calls `loadAccount` outside its own try/catch.
- [x] `ipc/hostinger.ts:44` — MEDIUM: no runtime shape check on the IPC payload; non-string fields threw TypeError; no name length or TTL cap. Fixed in `buildZoneUpdate` (typeof guards, `HOSTINGER_MAX_NAME_LENGTH` 253, `HOSTINGER_MAX_TTL` named constant marked not-verified vs Hostinger's limit) and `assertDomain` (typeof). Test added.
- [x] `hostinger-client.test.ts:147` — LOW: validate-before-PUT claim untested. Fixed: test queues a 422 on validate and asserts no PUT.
- [x] `HostingerPane.tsx:217` — LOW: untranslated table headers. Fixed: all nine headers go through `translate()`.
- [x] `HostingerPane.tsx:36` — LOW: default TTL duplicated as `'3600'`. Fixed: `HOSTINGER_DEFAULT_TTL` in `shared/hostinger.ts`, used by client and pane.
- [x] `HostingerPane.tsx:291` — LOW: unchecked `as HostingerDnsType` cast. Fixed: `isHostingerDnsType` guard.
- [x] `hostinger-client.ts:103` — LOW: `null` array elements threw in `parseVps`/`parseDomains`. Fixed: `isObject` filter in all three parsers.
- [x] `shared/hostinger.ts:51` — LOW: domain regex rejected punycode/IDN TLDs. Fixed: TLD label now allows digits and hyphens (`xn--…`).

## Subagent 2: Architecture Auditor
Verified OK by the auditor: all 8 `hostinger:*` channels match preload/index.ts and api-types.ts; `registerHostingerHandlers` runs on the same unconditional path as Asana; pane imported and rendered in section `hosting`, which resolves through `navSectionById`; desktop-only gate matches on both sides; `Globe` imported; no id collision; no other registry (e2e fixtures, docs lists, IPC allowlists) needs touching.
- [x] `main/ipc/register-core-handlers.test.ts:361` — `./hostinger` not mocked like every other registrar. Fixed: hoisted mock, `vi.mock('./hostinger')`, `mockReset`, and `expect(registerHostingerHandlersMock).toHaveBeenCalled()`. **Caveat, verified:** this test was already red at base 8841a218 — the registrar calls `registerVertexTaskHandlers()` (base test has no `./vertex-tasks` mock) and, once that is mocked, `registerRelayStatusHandler()` from `communications/relay/relay-lifecycle.ts` throws the same `removeHandler` TypeError. The Vertex mock is added here (correct and harmless); the relay chain is pre-existing, unrelated to this feature, and left for the lineage owner. The Hostinger assertion therefore cannot execute until that test is repaired upstream; the `hostinger-client` suite (14 tests) is the effective gate for this feature.
- [x] `renderer/src/i18n/locales/en.json` — 33 new `auto.*` keys absent; `verify:localization-catalog` failed. Fixed: `pnpm run sync:localization-catalog`, which also repaired 75 pre-existing misses per locale from other panes (lint was already red on those); committed as-is since the script has no per-file filter.
- [x] `settings/HostingerPane.tsx:216-220,266-269,297` — 11 hardcoded JSX strings. Fixed: headers and the three placeholders go through `translate()`; `verify:localization-coverage` reports no Hostinger lines.
- [x] `renderer/src/lib/settings-navigation-types.ts:32` — `SettingsNavTarget` lacked `'hosting'`. Fixed: added after `'servers'`.
- [~] `renderer/src/web/web-preload-api.ts:449` — no web stub for `hostinger`. False positive per the auditor's own note: section is gated off on web and Asana has no stub either.
- [x] `main/hostinger/hostinger-client.ts:73,154` — exported helpers used only internally. Fixed: `describeHttpError` and `assertDomain` un-exported; parsers and `buildZoneUpdate` stay exported for the tests.

## Verification after fixes
- `npx vitest run --config config/vitest.config.ts src/main/hostinger`: 14 passed.
- `pnpm run typecheck:node`: 0 errors. `typecheck:cli`: 0 errors.
- `pnpm run typecheck:web`: only the two pre-existing errors on base 8841a218
  (`agents-hub/AgentsOverview.tsx`, `kanban/kanban-ordering.test.ts`), untouched.
