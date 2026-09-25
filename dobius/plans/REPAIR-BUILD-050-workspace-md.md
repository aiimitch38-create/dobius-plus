# REPAIR BUILD-050 — Generated per-session workspace brief (PHASES.md Phase 9)

## Requirement (Carson's feature request)
Every terminal and agent session should start with a current description of its workspace: repo,
branch, worktree, what the app/folder is, which features live where, how to build and test it,
what is off-limits, and the current stabilization (Pause crew) gate.

## What was checked before building
- **Claude Code reads `CLAUDE.local.md`** at every directory from the cwd up to the filesystem
  root, but only when the `localSettings` source is enabled. Verified in the installed CLI
  (`claude` 2.1.282, strings of the binary): `if (zb("localSettings")) { ... "CLAUDE.local.md" ... "Local" }`.
  Interactive terminal sessions load all sources, so they read it.
- **SDK agent runs do NOT read it.** `startAgentRun` passes `settingSources: ['user','project']`
  (channel: `['project']`); `'local'` would also load `.claude/settings.local.json` permission
  rules into headless runs. Not changed here — see Decisions.
- **Codex precedence (installed `codex-cli 0.156.1`, strings of the vendored binary):**
  `core/src/agents_md.rs` discovers `AGENTS.override.md` then `AGENTS.md` per directory, and the
  bundled review prompt states "normal project-document precedence (`AGENTS.override.md`,
  `AGENTS.md`, then configured fallback filenames)". An override file therefore takes the place of
  the repo's `AGENTS.md` in that folder instead of adding to it; a generated `AGENTS.override.md`
  at a worktree root would hide `dobius/AGENTS.md`-style rules for the root folder. The only other
  route (an include from `AGENTS.md`) means editing a tracked file. So nothing is generated for
  Codex; only `CLAUDE.local.md`.
- **ADAM context pack:** unavailable (BUILD-031: `resolveContextPack` is reachable only from
  ADAM's write routes; no check-only handshake). Seam left in place; logged once per process.
- `CLAUDE.local.md` was NOT gitignored in this repo (`git check-ignore` exit 1). Added.

## Fix
- New `dobius/src/main/agents/session-workspace-brief.ts` — `refreshSessionWorkspaceBrief(cwd)`:
  resolves the git worktree root, refuses to touch a file that lacks the generated marker on its
  first line (or is a symlink/non-file), makes sure git ignores the file (existing ignore rules, or
  a local-only `/CLAUDE.local.md` line appended to `.git/info/exclude`; if git still cannot
  confirm, nothing is written), collects facts, re-checks the marker, writes atomically with
  `writeFileAtomic`. Never throws; concurrent calls for one folder share one refresh; folders
  that are not git worktrees are skipped (so no brief ever lands in `~` and applies to every
  session below it).
- New `session-workspace-facts.ts` — bounded git calls (1.5 s timeout each, `GIT_OPTIONAL_LOCKS=0`,
  no network): top-level/common-dir/git-dir, branch, short HEAD, dirty counts (numbers only, no
  file names); gate state from `checkExecutionAdmission('agent-run')` (reason only, never the
  control-file detail); for non-Dobius repos, build/test/typecheck/lint script NAMES from
  `package.json` (never bodies — they can embed env values). Measured ≈130 ms of git work on this
  repo.
- New `session-workspace-brief-render.ts` — pure renderer; user-controlled names are kept inside
  code spans. New `session-workspace-feature-map.ts` — checked-in component → paths → layer map from
  ARCHITECTURE-MAP §0/§14, commands from the repo `CLAUDE.md`, off-limits list.
- Hook points (one call each):
  - `agents/agent-runner.ts` Claude branch: after `resolveAgentRunCwd` (after the Pause-crew
    re-check), fire-and-forget `scheduleSessionWorkspaceBriefRefresh` (see review F3).
  - `runtime/dobius-runtime.ts` `createManagedWorktree` local path: after setup hooks, before the
    startup agent terminal is spawned.
  - `ipc/worktrees.ts` `worktrees:create` (the renderer's create path): local repos only (SSH and
    folder repos are skipped: the path is remote / not a worktree).
- Root `.gitignore`: `CLAUDE.local.md`.

## Tests
- `session-workspace-brief.test.ts` (13, real temp git repos): writes at the worktree root from a
  subfolder with branch/HEAD/dirty/gate; ignore via info/exclude (`git status` stays clean); no
  exclude edit when already ignored; linked worktree; user-authored file untouched and logged
  once; symlink untouched; own brief regenerated; non-git and missing folders skipped; paused and
  unreadable gate; no env values or script bodies; Dobius feature map section; ADAM log-once and
  pack seam; concurrent dedupe.
- `session-workspace-feature-map.test.ts` (2): every mapped path exists in this repo.
- `agent-runner-workspace-brief.test.ts` (2): brief awaited for the resolved cwd before `query()`;
  pause during the brief refresh blocks the run.
- `dobius-runtime.test.ts` +1, `ipc/worktrees.test.ts` +1: the create paths call the generator
  with the new worktree path.

Mutation checks (each made a test fail, then restored): M1 runtime hook removed; M2 IPC hook
removed; M3 runner hook not awaited; M4 pause re-check moved before the brief; M5 marker check
disabled; M6 symlink check disabled; M7 info/exclude step skipped; M8 script bodies leaked; M9
in-flight dedupe removed; M10 feature-map path drift; M11 linked-worktree detection broken.

## Verification
- `pnpm run typecheck` exit 0.
- Targeted: `src/main/agents`, `runtime/dobius-runtime.test.ts`, `ipc/worktrees.test.ts`,
  `ipc/worktrees-windows.test.ts`, `runtime/rpc/methods/worktree.test.ts`,
  `runtime/rpc/methods/custom-agents.test.ts`: 1198 passed, 2 failed. The 2 failures
  (`pre-marks remote Codex workspaces trusted before …`) also fail on the untouched base
  (`git show HEAD:` copies of `dobius-runtime.ts` and its test), so they are pre-existing.
- Sample output generated for this worktree: `stabilize-run/050/sample-CLAUDE.local.md`
  (file then removed from the worktree).
- oxlint clean on all new/changed files except the pre-existing `max-lines` on
  `agent-runner.ts` (494 → 496 counted lines; limit 300; the brief says call into a new module,
  which is what the one-line hook does).

## Deviations
- ADAM context pack (PHASES.md source 1) not used: no check-only route (BUILD-031). The generator
  takes a `WorkspaceContextPackProvider`; the default returns null and logs once.
- No Codex output (see precedence finding above).
- Codex SDK runs (`agent.engine === 'codex'`) are not hooked: nothing Codex reads is generated.
- Terminals opened later in an existing worktree (plain PTY spawn) are not hooked; the brief is
  written when the worktree is created and refreshed on every SDK run there.

## Rollback
Revert the commit. Generated `CLAUDE.local.md` files are git-ignored local files; delete them if
wanted. Lines appended to a repo's `.git/info/exclude` are local and harmless to leave.

## Lessons
- Claude Code gates `CLAUDE.local.md` on the `localSettings` source; SDK runs that restrict
  `settingSources` silently skip it.
- Codex `AGENTS.override.md` is a replacement, not an addition.

## Review fixes (second commit)
- **F1** `.git/info/exclude` append was not idempotent when `.gitignore` re-includes the file
  (`!CLAUDE.local.md`) or the file is tracked. Now: the exclude file is read first and the rule is
  not appended when the `/CLAUDE.local.md` line is present; roots git still will not ignore are
  remembered per process and skipped; in-flight dedupe (and the TTL cache) are keyed by worktree
  root, not cwd.
- **F2** Claude Code loads every `CLAUDE.local.md` from the cwd up to `/`, and Dobius worktrees
  nest inside the main checkout (`.claude/worktrees/*`). A main checkout (`git-dir == common-dir`)
  with any linked worktree under its own folder (from `git worktree list --porcelain`, realpath
  compared; failure to list = skip) gets no brief (`nested-worktrees`). The brief now says it
  describes only `<worktreeRoot>` and that any other brief above it belongs to a different checkout.
- **F3** SDK runs never read the file, so `startAgentRun` no longer awaits git:
  `void scheduleSessionWorkspaceBriefRefresh(resolvedCwd)` after the Pause re-check (a refused run
  does not touch the worktree; the runner's original line order is restored). Scheduled refreshes
  skip a root written within 60 s (`WORKSPACE_BRIEF_REFRESH_TTL_MS`). Worktree creation still
  awaits `refreshSessionWorkspaceBrief`, which ignores the TTL.
- **F4** Marker line now "generated by Dobius+ as of <time>; may be stale"; working-tree and gate
  lines are "as of <time>" in past tense. Marker prefix unchanged, so earlier files are still ours.
- Tests: `session-workspace-brief.test.ts` now 21 (re-include once + warn once, existing rule not
  re-appended, tracked marker file untouched, root-keyed dedupe across cwds, nested main checkout
  skipped / nested worktree written, sibling worktrees still written, TTL skip + creation bypass +
  expiry, schedule never rejects, exact marker wording); `agent-runner-workspace-brief.test.ts`
  (a never-settling refresh does not hold the run; a paused run does not schedule).
- Mutation checks (each failed a test, restored): N1 exclude-presence check removed; N2
  not-ignorable memory removed; N3 dedupe keyed by cwd; N4 nested check removed; N5 TTL ignored;
  N6 runner awaits the refresh; N7 old marker wording.
- Merged `stabilize/integration` (de122e81) first; the 2 remote-Codex trust test failures noted
  above were fixed there (BUILD-009C2). Targeted: 36 files, 1213 passed. Typecheck exit 0.
