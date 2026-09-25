# REPAIR BUILD-030 — ADAM connection registry (#81, #118)

## Root cause
Line numbers are pre-fix, on `stabilize/integration` (BUILD-029 had already moved the journal's
token/URL code out of `agent-run-event-journal.ts` into `agents/adam-event-ingest.ts`).
- **#81** Two independent ADAM connection resolvers:
  - Jarvis converse (`jarvis/adam-client.ts:11-45`): endpoint from Settings `voice.adamEndpoint`
    (passed by `jarvis-service.ts:111` and `jarvis-ipc.ts:197`), token from `DOBIUS_ADAM_TOKEN_PATH`
    or `~/dobius/projects/ADAM/service/data/service-token`, read ONCE per process and cached forever
    (`cachedToken`, including a cached `''` when the file was missing).
  - Event delivery (`agents/adam-event-ingest.ts:15-46`): endpoint from `ADAM_SERVICE_URL` env or a
    hardcoded `http://127.0.0.1:8791` (Settings ignored), token from `ADAM_SERVICE_TOKEN` /
    `ADAM_SERVICE_TOKEN_PATH` (different env names) or the same hardcoded path.
  - Result: changing the endpoint in Settings moved converse but not events; a rotated/installed
    token reached events but not converse until restart.
- **#118** `~/dobius/projects/ADAM` was hardcoded three times (`adam-client.ts:12`,
  `adam-event-ingest.ts:31-39`, `self-edit.ts:64`). A machine without that folder had no named
  state: converse sent an unauthenticated request and reported "ADAM is unreachable"; delivery
  reported `no-token: token file ENOENT`.

## Fix
- New `src/main/adam-connection.ts` — the one registry. Resolved on every call, no cache:
  - endpoint: `ADAM_SERVICE_URL` env → Settings `voice.adamEndpoint` → `DEFAULT_ADAM_ENDPOINT`;
    trailing slashes stripped. Delivery (no store handle) reads Settings through
    `setAdamEndpointSettingReader`, wired in `index.ts` right after `store = new Store()` and before
    delivery starts (same pattern as `setClaudeSettingsOverrideReader`).
  - token: `ADAM_SERVICE_TOKEN` env → file at `ADAM_SERVICE_TOKEN_PATH` → legacy
    `DOBIUS_ADAM_TOKEN_PATH` → `<ADAM dir>/service/data/service-token`.
  - ADAM dir: `DOBIUS_ADAM_PROJECT_DIR` env → `~/dobius/projects/ADAM`.
  - `resolveAdamToken()` → `{token}` | `{token: undefined, state: 'not-installed' | 'no-token',
    detail}`. `not-installed` only when no env token/path is configured and the ADAM dir does not
    exist. Detail is a fixed phrase or errno only, never the token or a path.
  - `errorCode` moved here; `adam-event-ingest.ts` re-exports it so BUILD-029 imports are unchanged.
- `adam-client.ts`: token cache (`loadAdamServiceToken`, `adamServiceTokenPath`,
  `resetAdamServiceTokenCacheForTests`) and `adamProjectDirectory` removed. New `askAdam({
  settingsEndpoint, utterance, fetchFn })` resolves through the registry: `not-installed` → error
  "ADAM is not installed on this Mac" with no request; `no-token` keeps the old behavior (request
  without a Bearer header, ADAM answers 401 → "unreachable"). `converseWithAdam` unchanged.
- `jarvis-service.ts` and `jarvis-ipc.ts` call `askAdam`; `jarvis:getAdamProjectDirectory` uses the
  registry.
- `adam-event-ingest.ts`: POSTs to `${resolveAdamEndpoint()}/v1/events/ingest` (same base-URL join as
  converse). Token resolution removed (lives in the registry).
- `agent-run-event-delivery.ts`: uses `resolveAdamToken()`; new health state `not-installed`
  (events stay queued, retried on the BUILD-029 backoff, picked up when ADAM appears).
- `self-edit.ts`: `selfEditRoots` uses `adamProjectDirectory(home)`. BUILD-019 sha256 conflict check
  and undo untouched.

## Files
- new `src/main/adam-connection.ts`, `src/main/adam-connection.test.ts`
- `src/main/jarvis/adam-client.ts`, `adam-client.test.ts`, `jarvis-service.ts`,
  `jarvis-service.test.ts`, `jarvis-ipc.ts`, `self-edit.ts`, `self-edit.test.ts`
- `src/main/agents/adam-event-ingest.ts`, `agent-run-event-delivery.ts`,
  `agent-run-event-journal.test.ts`
- `src/main/index.ts` (one import + one reader line)

## Tests
- `adam-connection.test.ts`: dir default/override; endpoint precedence + live reader change;
  not-installed; no-token (missing/empty); token re-read after install and rotation; full token
  precedence; explicit path works without an ADAM dir.
- `adam-client.test.ts` `askAdam`: not-installed → named error, no fetch; changed endpoint AND rotated
  token used on the next ask; installed-without-token still asks without Bearer.
- `agent-run-event-journal.test.ts`: delivery follows a changed Settings endpoint and rotated token
  without restart (#81); missing ADAM → `not-installed` health, no fetch, no crash, delivered after
  ADAM appears, token never in warnings (#118); `index.ts` wires the reader after the store and
  before delivery starts.
- `self-edit.test.ts`: `selfEditRoots` honors the configured ADAM location.

## Mutation checks (each broke the named tests, then restored)
- M1 re-add a process-lifetime token cache → 6 fail (rotation/precedence in registry, askAdam, journal #81).
- M2 hardcode the ingest URL → journal #81 fails.
- M3 drop the not-installed branch → 4 fail (registry, askAdam, journal #118).
- M4 askAdam ignores not-installed → askAdam not-installed test fails.
- M5 hardcode the self-edit ADAM root → self-edit #118 test fails.
- M6 remove the `index.ts` reader wiring → N5/#81 source test fails.
- M7 endpoint ignores Settings → 3 fail (registry, askAdam, journal #81).

## Verification
- `pnpm run typecheck` exit 0.
- `npx vitest run --config config/vitest.config.ts src/main/adam-connection.test.ts src/main/jarvis src/main/agents` → 34 files, 487 passed.
- `npx oxlint` and `npx oxlint --config config/oxlint-react-doctor.json` on every changed file: clean.
- Full suite: DEFERRED to coordinator.

## Deviations from EXECUTION-ORDER.md
- The journal's ADAM config no longer lives at `agent-run-event-journal.ts:37-58`; BUILD-029 moved it
  to `agents/adam-event-ingest.ts` + `agent-run-event-delivery.ts`, so those were edited instead.
- Touched `src/main/index.ts` (one reader line) and `jarvis-service.ts` / `jarvis-ipc.ts` (callers of
  the removed token cache) outside the named file list.
- ADAM dir is configured by env `DOBIUS_ADAM_PROJECT_DIR`, not a new Settings field (no UI/feature).

## Decisions
- Env `ADAM_SERVICE_URL` beats the Settings endpoint (explicit per-launch dev/test override).
- Installed-but-no-token converse still sends the request without a Bearer header (pre-existing
  behavior); only a missing ADAM folder short-circuits.

## Rollback
Revert the commit. No persisted data format changes.

## Lessons
- BUILD-029 had already split the journal; spec line anchors pointed at pre-029 code. Grep the
  symbols, not the line numbers.

## Review fixes (second commit)
- **F1** `DOBIUS_ADAM_PROJECT_DIR` could set the self-edit write root (a value of `/` or `$HOME` would
  widen self-edit to the disk). `selfEditRoots` now uses `defaultAdamProjectDirectory(home)` (fixed
  `~/dobius/projects/ADAM`); the override only locates ADAM and its token.
- **F2** A Settings endpoint on any host received the bearer token and event text. New
  `resolveAdamTarget()`: a Settings/default endpoint must be http(s) on localhost, 127.0.0.0/8, ::1,
  100.64.0.0/10 or `*.ts.net`; anything else (including malformed) → `blocked-endpoint`. Converse
  returns "ADAM endpoint blocked: Settings must point at this Mac or your tailnet" without a request;
  delivery reports health `blocked-endpoint`, keeps its queue and cursor, and retries on backoff.
  `ADAM_SERVICE_URL` (env) stays trusted as a developer override.
- **F3** `jarvis-service.test.ts` now saves, clears and restores `ADAM_SERVICE_TOKEN`,
  `ADAM_SERVICE_TOKEN_PATH` and `ADAM_SERVICE_URL`.
- Test endpoints that used example hosts (`adam.one`, `adam.test`) now use loopback addresses.
- Mutation checks: F1 self-edit root follows the override → self-edit F1 test fails; F2a allowlist
  disabled → 4 fail; F2b askAdam skips the check → askAdam F2 test fails; F2c ingest skips the
  check → journal F2 test fails; F3 env clearing removed + `ADAM_SERVICE_URL` set in the shell → 2
  jarvis-service tests fail (they pass with the fix and the same polluted env).
- Verification: typecheck exit 0; targeted vitest 34 files / 492 passed; oxlint clean.
