# TASK HOST-1.1 — Hostinger integration (settings pane: token, servers, domains, DNS)

Branch `feat/hostinger-integration`, worktree `/Users/bayou/Projects (Code)/dobius-plus/hostinger`,
based on `fix/channel-cost` @ 8841a218 (the newest app lineage; `main` is the old
electron/*.js codebase and has no `dobius/`).

## What
A first-class Hostinger integration mirroring the Asana one:
- **Token**: set / clear / status, encrypted at rest with `safeStorage` in
  `~/.dobius/hostinger-token.enc` (same pattern as `asana-token-store.ts`). Renderer
  never sees the token.
- **Read**: list VPS (hostname, plan, state, IPv4, template), list domains (name,
  type, status, expiry), list DNS records for a chosen domain.
- **One write**: add or update a DNS record (A / AAAA / CNAME / TXT). Reachable only
  from an explicit click, like `asana:completeTask`.
- Settings pane `HostingerPane` mounted as a new section `hosting` in the
  **Remote Hosts** nav group, next to "Remote Dobius+ Servers".

## Why
Carson's one Hostinger VPS (45.82.75.172) is the Dobius box and the planned host for
Vigbets; the domains live in the same account. Today none of that is visible from
the app and DNS changes mean logging into hPanel.

## Not in scope (YAGNI, and destructive)
VPS start/stop/restart/reinstall, domain purchase, deploys, billing. Adding those
later is a new IPC handler each; nothing here forecloses them.

## Files
New: `shared/hostinger.ts`, `main/hostinger/hostinger-token-store.ts`,
`main/hostinger/hostinger-client.ts` (+ `.test.ts`), `main/ipc/hostinger.ts`,
`renderer/.../settings/HostingerPane.tsx`, `renderer/.../settings/hostinger-search.ts`.
Edited: `main/ipc/register-core-handlers.ts` (one call), `preload/index.ts` and
`preload/api-types.ts` (one block each), `settings/Settings.tsx` (import + section),
nav metadata if sections are registered there.

## Test
- `pnpm run typecheck:node`, `typecheck:web`, `typecheck:cli` exit 0 (pnpm scripts
  only — LESSONS 2026-08-29).
- `npx vitest run --config config/vitest.config.ts src/main/hostinger` passes:
  client builds the right paths/headers, parses VPS/domain/zone payloads, maps
  HTTP errors, and the DNS write refuses an invalid domain or record type.
- Manual: `npm run electron:dev` → Settings → Remote Hosts → Hostinger: set token,
  see 1 VPS + 4 domains, view `vertexio.online` records.

## Risks
- Hostinger DNS write semantics (`overwrite`) — verified against the official API
  reference before implementing; see the client's doc comment.
- Shared checkout is dirty on `fix/channel-cost` — this worktree never touches it.
- Disk: 2.7 GB free; no builds beyond typecheck/vitest in this task.

## Estimate
Half a day.
