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

## Before you report: self-check against what Codex keeps finding (added 2026-11-22)
Every new IPC handler / RPC method / CLI path must pass these, or Codex sends it back:
- **Sender check:** IPC handlers accept only a registered app window's top frame (copy `isTrustedRuntimeCallSender` in `main/ipc/runtime.ts`). Never trust renderer-supplied ids for routing or permissions; main decides.
- **Races:** anything with an await between a check and an action re-checks after the await. Two windows / two calls at once must not double-act. Persist state before side effects; roll back exactly what this attempt did, only if it is still yours.
- **Terminal delivery:** text sent into a terminal goes through guarded delivery (`requireAgentStatus: 'sendable'`, text then guarded Enter after the settle delay), and Pause crew (execution gate) is checked right before acting.
- **Untrusted text:** titles, reports, thread history going into a prompt are encoded (JSON string, `<`/`>` escaped), never raw inside tags.
- **Bounded:** every list/map/queue that grows has a cap; every timer/listener is disposed on shutdown/unmount.
- **Failure paths:** a failed save/spawn leaves a retryable state, never a stuck one.
Then, if the Codex CLI is available, run it once read-only on your own diff before reporting (`C="$(npm root -g)/@openai/codex/bin/codex.js"; node "$C" exec -s read-only -C <worktree> - < brief.md`, brief = what changed + "ranked list: severity, file:line, scenario, minimal fix"), fix what it finds, and include its verdict in your report.
