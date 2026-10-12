# Dobius+ — Electron desktop app for Claude Code, Codex and other agent CLIs

## Repo role — read this first

- **The one real repo is `~/Projects (Code)/Dobius/dobius-plus`.** It is the PR vehicle into
  `statusdigitalmarketing/dobius-plus`. Git worktrees of it are fine; other checkouts are not.
- `~/Projects (Code)/dobius-plus/` holds older 1.0.x lane checkouts. Never edit, build or
  install from there, and never from `dobius-plus-redesign`, `dobius-shell-rebrand`,
  `dobius-parallel-worktrees` or any other side copy, unless Carson explicitly redirects you.
- **The app is V2, under `dobius/`.** Its own agent rules are in `dobius/AGENTS.md` (loaded
  through `dobius/CLAUDE.md`) — follow them for any code change.
- **The repo root is the legacy V1 app** (`electron/`, `src/`, `electron-builder.yml`, root
  `package.json` 1.0.x). Do not build, package or extend it. Root scripts without a `legacy:`
  prefix only forward to `pnpm --dir dobius …`.
- Local-first: build, test and install on this Mac until the app works. Push and open a PR only
  at a stable checkpoint, and only when Carson asks.

## Project memory

Session notes live in `.dobius/NOTES.md` in the main checkout (not tracked by git; also editable
from the Dashboard "Notes" tab). It is imported below. Read it, and append a dated note when you
learn something durable. Older notes can be stale: check them against the code.

@.dobius/NOTES.md

## Layout of `dobius/`

- `src/main/` — Electron main process (windows, terminal daemon client, agents, storage, updater)
- `src/preload/` — the bridge between main and renderer
- `src/renderer/` — the React UI
- `src/shared/` — types and logic used by both sides
- `src/cli/` and `src/relay/` — the `dobius` CLI and the SSH relay
- `config/` — build, lint, typecheck and test config; `config/scripts/` holds build and check
  scripts with their tests
- `plans/` — one plan file per repair build (`REPAIR-BUILD-NNN-*.md`)

## Commands

Run from `dobius/` (or prefix with `pnpm --dir dobius` from the repo root). Use pnpm, never npm.

```bash
pnpm run dev                                   # dev app (electron-vite)
pnpm run typecheck                             # all three tsgo projects; must exit 0
npx vitest run --config config/vitest.config.ts <files or dirs>   # targeted tests
npx oxlint <files>                             # lint the files you changed
pnpm run build                                 # full compile (typecheck, relay, electron-vite, web, CLI, native)
```

- Typecheck only through `pnpm run typecheck`; bare `npx tsgo --noEmit` does not work in this repo.
- `pnpm test` rebuilds native modules into `node_modules` first. In a worktree whose
  `node_modules` is shared, run vitest directly instead.

## Build and install into `/Applications/Dobius+.app`

One path only, from the repo root:

```bash
pnpm --dir dobius run build:unpack
scripts/install-dobius-gated.sh dobius/dist/mac-arm64/Dobius+.app [--take-over] [--allow-downgrade]
```

The gated installer takes a lock, refuses another branch's install without `--take-over` and an
older version without `--allow-downgrade`, validates a staged copy (including every build
artifact) before quitting the app, swaps it in atomically and keeps one rollback copy. Exit codes,
rollback and the signed release build are in `RELEASING.md`.

- `build-and-install.sh` and `scripts/install-dobius-v2.sh` are retired pointers (they exit 1).
- Never copy, move or delete `/Applications/Dobius+.app` by hand; the global install-gate hook
  blocks it.
- Never kill the app by bundle path: the terminal daemon runs from inside the bundle and killing
  it ends every live terminal session. See "Stopping the app by hand" in `RELEASING.md`.

## Important notes

- Carson's live data is in `~/Library/Application Support/dobius-plus/` (Electron `userData`
  comes from the package name `dobius-plus`; `app.setName('Dobius+')` runs after it is cached).
  Dev runs use `~/Library/Application Support/Dobius+-dev/`. Never hand-edit or reset the live
  folder.
- Auto-update is disconnected (`dobius/src/main/dobius-disconnect.ts`); the gated installer is the
  only thing that replaces the app.
- Stabilization program docs (bug list, execution order) are in `docs/stabilization/`.
