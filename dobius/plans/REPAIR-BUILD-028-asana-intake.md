# REPAIR BUILD-028 — Asana intake: review lane, pagination, allowedProjects (#54 #72 #120)

## Root cause
- **#54** `asana-client.ts` `fetchLane()` sent `completed_since=now` for BOTH lanes. Asana returns
  incomplete tasks plus tasks completed after `completed_since`, so `now` returns only incomplete
  tasks. The review lane then dropped every incomplete task (`lane === 'review' && !t.completed`),
  so the review lane was always empty. The extra `modified_since=48h` could not help.
- **#72** One request per workspace with `limit=50`; `next_page` was never read, so any assignee
  with more than 50 matching tasks silently lost the rest.
- **#120** `allowedProjects` was stored and migrated (`asana-config.ts`, `migrate-legacy-dobius-config.ts`)
  but never read by intake; `projects` was not even requested from Asana.

## Fix
- Review lane semantics (kept from the doc comment): tasks **completed in the last 48h**. Query sends
  `completed_since=<now-48h ISO>` and keeps only completed tasks. `modified_since` removed (redundant:
  a task completed in the window was modified in it). Build lane unchanged (`completed_since=now`).
- Pagination: `fetchAllTaskPages()` follows `next_page.offset` with `limit=100` (Asana max).
  Dedupe by gid across pages and workspaces (existing `seen` set now spans all pages).
  Loop guards: a repeated offset throws; more than 100 pages throws. Both fail the refresh (lastError
  set, previous snapshot kept) instead of silently truncating.
- Rate limits (BUG-MATRIX #72 test column): `asanaGet` now rejects with `AsanaHttpError`
  (status + parsed `Retry-After`; message text unchanged). `asanaGetWithRetry` retries a 429 at most
  2 times, waiting `Retry-After` (default 1s, capped 60s). Other errors are not retried.
- allowedProjects (revised after review F1): it is the **Auto Mode allowlist only**, the legacy
  meaning (`electron/asana-queue.js:4-10`, `config-manager.js:49`). `fetchLane` requests
  `projects.gid` and carries it on each task as optional `AsanaTask.projectGids`. The Tasks panel
  / CLI snapshot (`refreshAsanaTasks`) is never filtered. `maybeDispatchTask` in
  `asana-auto-mode-service.ts` skips tasks not allowed by `isAllowedForAutoMode()`.
  **Empty list = every project** (including tasks in no project). Non-empty = only tasks in at
  least one listed project; project-less tasks are excluded from auto-processing only.
  Documented at `sanitizeAllowedProjects` in `asana-config.ts`.
- Review F2: `fetchWorkspaces()` also goes through `asanaGetWithRetry`.

## Files
- `src/main/asana/asana-client.ts`, `asana-config.ts` (comment only), `src/shared/asana.ts`
  (optional `projectGids`), `src/main/agents/asana-auto-mode-service.ts` (allowlist).
  `asana-queue-service.ts` ends up unchanged versus the base branch.
- Tests: `asana-client.test.ts` (extended, 8 new cases, fixed clock 2026-09-20T12:00Z via fake
  `Date` only), `asana-queue-service.test.ts` (new). No real Asana calls: `node:https` is mocked.

## Verification
- `pnpm run typecheck` exit 0. `npx vitest run src/main/asana/` 20/20; plus
  safe-json-store-migrations, asana-auto-mode-producer/admission, migrate-legacy-dobius-config,
  dispatch-server: 63/63 after the review fix. oxlint + react-doctor clean on all changed files. Full suite: deferred.
- Mutation checks (each made tests fail, then restored; files verified identical to backup):
  M1 review `completed_since=now` (1 fail); M2 ignore next_page (4); M3 no gid dedupe (1);
  M4 no repeated-offset guard (1); M5 no 429 retry (2); M6 unbounded retry (1, timeout);
  M7 no project filter (1); M8 empty list filters everything (5); M9 no `projects.gid` field (1);
  M10 queue service drops filter for review lane (2; superseded by the review fix).
- Review-fix mutation checks: F1a no Auto Mode allowlist (1 fail); F1b empty list blocks all (5);
  F1c snapshot filtered by allowedProjects (1); F1d projectGids not carried (1); F2
  fetchWorkspaces back to plain `asanaGet` (1). All restored and diffed against backups.

## Rollback
Revert the commit. No data format changes; config file untouched.

## Deviations from EXECUTION-ORDER.md
- Added bounded 429 retry (named in BUG-MATRIX #72 fix/test columns, not in EXECUTION-ORDER).
- allowedProjects is applied in Auto Mode (`asana-auto-mode-service.ts`, outside the spec's file
  list) instead of in intake, to keep the legacy meaning; `AsanaTask` gains optional `projectGids`
  (`src/shared/asana.ts`). Producer/admission test mocks gain `allowedProjects: []`.

## Decisions for Carson
- allowedProjects limits Auto Mode only (legacy meaning); the Tasks panel shows everything.
  Empty list = Auto Mode may process every project. There is no UI for this list today.
- Review window stays 48h (completed in the last 48h). It must stay well under the dispatch
  ledger's 30-day retention, or pruned review tasks could be re-dispatched.

## Lessons
- Asana `completed_since` is "incomplete OR completed after X", so `now` means "incomplete only".
