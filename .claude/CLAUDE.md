# Dobius+ — Claude workflow layer

> **Read order:** `~/.claude/CLAUDE.md` (global house rules) → `../CLAUDE.md` (repo root:
> repo role, layout, commands, install) → `../dobius/AGENTS.md` (code rules) → this file.
> Global rules always win. This file only adds workflow context; it does not repeat the others.

## Where to work

- The repo is `~/Projects (Code)/Dobius/dobius-plus`; the app is V2 under `dobius/`. The repo
  root's `electron/` and `src/` are the legacy V1 app — do not change them.
- Before any build or install, `git rev-parse --show-toplevel` must print that repo (or one of its
  git worktrees), and the build must contain the commits you mean to ship.
- Work on a feature branch, never on `main`. Do not push, open PRs or cut releases unless Carson
  asks.

## Done-bar additions for this repo

Run from `dobius/`:

- `pnpm run typecheck` exits 0.
- Targeted tests: `npx vitest run --config config/vitest.config.ts <your test files>` is green.
  In a worktree with a shared `node_modules`, never run `pnpm test` or `pnpm install` (both
  rebuild native modules in place).
- `npx oxlint <changed files>` is clean, and so is
  `npx oxlint --config config/oxlint-react-doctor.json <changed files>`.
- Repair builds write a plan file in `dobius/plans/` before the fix.
- To see a change in the real app, install it only through the gated path in `../RELEASING.md`
  (`pnpm --dir dobius run build:unpack`, then `scripts/install-dobius-gated.sh`). Never write to
  `/Applications/Dobius+.app` any other way.

## Critical reminders

- Carson's live data (`~/Library/Application Support/dobius-plus/`) is never hand-edited, reset or
  deleted.
- Never kill the app by bundle path; the terminal daemon lives inside the bundle (see
  `../RELEASING.md`, "Stopping the app by hand").
- When a docs command, path, flag or installer exit code changes, update `../RELEASING.md` and the
  root `../CLAUDE.md` in the same commit; `dobius/config/scripts/check-docs-references.test.mjs`
  fails otherwise.
