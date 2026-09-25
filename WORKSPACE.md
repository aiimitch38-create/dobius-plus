# Dobius+ Workspace Map

Last reviewed: 2026-09-07

## Current checkout

- Repo root: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`
- Current branch: `feat/buzz-terminal-skin`
- Upstream remote: `origin` → `statusdigitalmarketing/dobius-plus`
- Fork remote: `fork` → `aiimitch38-create/dobius-plus`

Project guidance in `CLAUDE.md` and `dobius/AGENTS.md` refers to
`/Users/bayou/Projects (Code)/dobius-plus`. That does not match this checkout's
actual path. Resolve that path mismatch before any build/install/push workflow
that depends on an exact repository location.

## What to edit

- `dobius/` is the active Dobius app source.
- Root `package.json` delegates the normal `dev`, `build`, `start`, and
  `electron:*` commands into `dobius/`.
- Root `src/`, `electron/`, `mobile/`, `vite.config.js`, and
  `vite.mobile.config.js` appear to be legacy V1 app code. Do not expand this
  surface unless the task explicitly targets the legacy app.

## Root files that must stay in place

These files are referenced by scripts or runtime code and should not be moved
without updating those references:

- `HANDOFF.md`
- `BUILD-LOG.md`
- `claude-progress.json`
- `AUTONOMOUS-BUILD.md`
- `LESSONS-LEARNED.md`
- `RELEASING.md`

## Planning/documentation layout

- `plans/` — root build/task plans and reviews.
- `plans/algorithm/` — Algorithm-specific project plans.
- `dobius/plans/` — current app implementation reports and design plans.
- `dobius/skills/` — project-local Codex skills. `ponytail` documents the
  Dobius convention for searchable rationale comments and architecture
  guardrails.
- `dobius/docs/` — mostly local-only design/feature docs. `dobius/.gitignore`
  intentionally ignores `docs/**` except allow-listed durable docs such as
  `docs/STYLEGUIDE.md`.
- `dobius/notes/` — local implementation notes.

## Generated/local-only paths

Do not commit generated or machine-local contents from:

- `.playwright-cli/`
- `.playwright-mcp/`
- `.remember/`
- `.dobius/`
- `dist/`
- `dobius/node_modules/`
- `dobius/out/`
- `dobius/output/`
- `dobius/test-results/`
- `dobius/artifacts/`
- `scripts/supervisor.log`

## Current caution flags

- There are existing modified files under `dobius/` and `scripts/`; preserve
  them unless the active task explicitly owns those changes.
- Root screenshots and `sqlite_mcp_server.db` are tracked files. Do not move or
  delete them as "cleanup" without a specific decision to change repository
  history/layout.
- `dobius/docs/*.md` files currently show as ignored/untracked because
  `dobius/.gitignore` treats most docs as local-only. If any of those docs are
  durable project documentation, update the allow-list before committing them.

## Obsidian session context

Relevant local vaults:

- `/Users/bayou/Obsidian Vault/AI Research`
- `/Users/bayou/Projects (Code)/VAULT1`

High-signal Dobius notes found in Obsidian:

- `Dobius Canonical Workspace.md` says the intended canonical source is
  `dobius/` inside `/Users/bayou/Projects (Code)/dobius-plus`; this conflicts
  with the current checkout path above and should be resolved deliberately.
- `Dobius Collaboration Model.md` says Carson is a collaborator, not the owner:
  keep the owner's engine/backend intact, layer UI and scale improvements on
  top, and ship small reviewable increments rather than a big-bang cutover.
- `Vertex And Dobius Architecture.md` defines Vertex as the command/OS layer and
  Dobius as the execution engine. Target flow: `Domain Objects → Command Bus →
  Services → Event Bus → Persistence → Views`.
- `Dobius Dictation ONNX Crash.md` diagnoses Cmd+E dictation crashes as native
  ONNX memory aborts under low RAM. Smallest fix is memory preflight before
  worker spawn; structural fix is moving STT out of the Electron main process
  worker thread into a child/utility process.
- `Sessions 2026-09-07.md` repeatedly confirms this current checkout path and
  branch as active context for recent Dobius work.

## Fast orientation commands

```bash
git status --short
git status --ignored --short
pnpm --dir dobius test
pnpm --dir dobius typecheck
pnpm --dir dobius lint
```

## Feature workflow

Use `dobius/` as the only active application surface.

1. **Frame the change.** Read this file, `dobius/AGENTS.md`, the style guide,
   and relevant Obsidian notes. Write the smallest acceptance criteria before
   editing. Keep unrelated dirty files untouched.
2. **Choose the correct layer.** Put durable domain and process behavior in
   `src/main/<domain>`, renderer-only behavior in
   `src/renderer/src/components` or a concrete renderer library module, shared
   request/response types in `src/shared`, and only explicit IPC wiring in
   `src/preload`.
3. **Build a vertical slice.** Add the contract/service first, then the
   renderer action, then the smallest focused test. Keep local and SSH/runtime
   selection explicit; never let a localhost UI URL silently route through a
   remote runtime.
4. **Use agents by ownership.** Give one agent one bounded surface (for
   example, `renderer-tab-menu`, `main-dev-service`, or `tests`). The
   coordinator owns integration and shared contracts. Agents report changed
   files, assumptions, and validation commands; they do not rewrite unrelated
   files or run broad format/lint autofixes.
5. **Validate in increasing cost order.** Run the focused Vitest files, targeted
   Oxlint, `pnpm --dir dobius typecheck`, `git diff --check`, then the relevant
   build or E2E smoke test. Run the full suite only at a release checkpoint.
6. **Install only from this checkout.** Confirm `git rev-parse --show-toplevel`,
   build with `pnpm --dir dobius build:unpack`, and use
   `scripts/install-dobius-gated.sh dobius/dist/mac-arm64/Dobius+.app`.
   Verify the installed bundle's version, executable, process, and its
   install record (`INSTALL-PROVENANCE.json`, see `RELEASING.md`) after relaunch.

## Architecture map

```text
renderer UI -> preload IPC -> main services -> persistence / runtime / relay
     ^              |                |
     +------ shared contracts -------+
```

- `src/main/` is the privileged application layer. Group new behavior by
  concrete domain; avoid adding generic `helpers`, `utils`, or catch-all files.
- `src/preload/` is the narrow security boundary. Expose capabilities, not
  arbitrary Node APIs.
- `src/shared/` owns types and protocol constants shared across process
  boundaries.
- `src/renderer/src/` owns views, interaction state, and browser-safe helpers.
- `src/relay/` owns relay transport concerns; do not mix it into UI modules.
- `src/cli/` owns command-line behavior and should remain independently
  testable.
- `config/`, `scripts/`, and `tests/` are build/verification infrastructure,
  not feature code.

## Current feature additions

- The `+` tab menu now includes a local **Dev Environment** browser tab. It
  resolves the packaged renderer's local HTTP origin and deliberately stays on
  the client machine instead of using a remote runtime.
- The app release metadata is now `2.0.0` rather than `2.0.0-rc.1`.
