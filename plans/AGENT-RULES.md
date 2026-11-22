# Rules for every worker agent (read first)

- Product: Dobius+, Carson's Electron + React 19 + TypeScript desktop app; source in `dobius/`. Carson is learning to code: anything he reads must be plain English.
- Home base: `~/Projects (Code)/dobius-plus/WORKSTATION-BUILD` (branch `aiimitch38-create/workstation-build`). The orchestrator merges. Master plan: `plans/WORKSTATION-BUILD-PLAN.md`; its top "Audit 2026-11-21" box and `plans/research/IRIS-PLAN-AUDIT-20261121.md` win over older rows.
- Work ONLY inside the worktree named in your task. Never edit WORKSTATION-BUILD, the main checkout `~/Projects (Code)/Dobius/dobius-plus`, or another WB-* folder.
- `dobius/node_modules` is a symlink to a shared install: NEVER run `pnpm install`/`npm install`. NEVER run `pnpm run build:cli` (it breaks the app build next to it).
- Typecheck from `dobius/`: `pnpm run typecheck:node`, `typecheck:web`, `typecheck:cli` (never bare `tsgo`, never `config/tsconfig.web.json`). Tests: `npx vitest run --config config/vitest.config.ts <paths>` from `dobius/`.
- Known baseline test failures (not yours): ~164 in `src/main/ipc/pty.test.ts`; 16 in renderer terminal-pane tests (layout-serialization, pty-connection, terminal-handle-links, terminal-link-handlers); 1 in BoardHome; ~59 in communications. Always take your own baseline before changing code and compare.
- Never: git push, PR, install to /Applications, Asana, deleting branches, killing a process you did not start, reading secret files (`.env*`, tokens, credentials), switching workspaces in the real Dobius app.
- Commit only your files (`git add <paths>`), one commit per item; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pre-commit hooks must pass (never `--no-verify`).
- Bug fixes: root cause, at the shared function all callers route through, with the smallest test that fails before and passes after.
- Your final message is DATA for the orchestrator: what you did, commit SHAs, files changed, test/typecheck results (before vs after), anything unverified (say "unverified"), open questions for Carson each with a recommended default. If blocked, say so plainly and stop; do not guess.
