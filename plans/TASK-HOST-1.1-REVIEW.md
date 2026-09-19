# TASK HOST-1.1 — Review

Re-read every changed file: `shared/hostinger.ts`, `main/hostinger/hostinger-token-store.ts`,
`main/hostinger/hostinger-client.ts` (+ test), `main/ipc/hostinger.ts`,
`main/ipc/register-core-handlers.ts`, `preload/index.ts`, `preload/api-types.ts`,
`settings/HostingerPane.tsx`, `settings/hostinger-search.ts`, `settings/Settings.tsx`,
`hooks/useSettingsNavigationMetadata.ts`.

**Fixed one thing:** `parseVps` did `Number(v.id)` on a missing id → `NaN` as a React
key and IPC payload. Now falls back through `parseInt` to `0`.

**Checked and left alone:**
- Token never crosses IPC to the renderer; only `hasToken`/`status` do. Same as Asana.
- The only write (`hostinger:upsertDns`) validates domain (regex), type (allowlist),
  and non-empty content in the main process before any request, calls
  `/validate` before `PUT`, and re-reads the zone so the UI shows server truth.
- `overwrite: true` matches the pane's copy "Replaces existing values for the same
  name and type" — and the OpenAPI description of the flag.
- Section `hosting` is desktop-only (`showDesktopOnlySettings`), like Automation;
  nav entry sits in the `remote` group under "Remote Dobius+ Servers".
- i18n uses `translate(key, default)` with new `auto.*` keys, matching AsanaPane.
- No hardcoded colors; tables use existing `text-muted-foreground` / `border-border` tokens.

**Verification:**
- `pnpm run typecheck:node` exit 0, `typecheck:cli` exit 0.
- `pnpm run typecheck:web` exit 2 with two errors in `agents-hub/AgentsOverview.tsx`
  and `kanban/kanban-ordering.test.ts` — untouched files, present on the base commit
  `8841a218` (`VertexTaskStatus` gained `blocked`, `VertexTask` gained
  `childTaskIds`). Pre-existing baseline, not introduced here; not fixed here
  (out of scope, and the shared checkout's owner may already have it in flight).
- `npx vitest run --config config/vitest.config.ts src/main/hostinger`: 11 passed.

**Not verified:** the pane rendering in the running app (`npm run electron:dev`).
Per LESSONS "Never ship to the installed app what you haven't watched run", this
branch must be watched in dev before any install to `/Applications/Dobius+.app`.
