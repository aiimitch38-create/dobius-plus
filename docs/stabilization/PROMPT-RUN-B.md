# Run B — Phases, execution order, branches, gates, BUILD-001 (planning only, no fixes)

## Role and stakes

You are the principal engineer planning the stabilization of **Dobius+ V2**. It's an Electron desktop app that runs real shell terminals and paid AI coding agents for one solo developer, Carson.

Run A already produced a repository-grounded architecture map and a 123-row bug matrix. Your job is to turn them into an executable program: small, reviewable, reversible builds in the right dependency order. Later coding agents will execute each build with a strict per-fix cycle: diagnose → plan → minimal fix → verify → review → commit → log. **Design builds that fit that cycle.**

## Where things are (absolute paths)

- **Working directory (the only place you may write):**
  `/Users/bayou/Projects (Code)/Dobius/dobius-plus/.claude/worktrees/stabilize-iris` (branch `stabilize/iris-20260923`)
- **Full source to READ:** `/Users/bayou/Projects (Code)/Dobius/dobius-plus` (active app in `dobius/`; repo-root `src/`, `electron/`, `mobile/` are legacy V1)
- **ADAM service:** `/Users/bayou/dobius/projects/ADAM`

## Read first

1. `docs/stabilization/BUG-LIST-123.md`: canonical numbering, by-design items, X-items.
2. `docs/stabilization/BUG-MATRIX.md` and `docs/stabilization/ARCHITECTURE-MAP.md`: from Run A. Treat `Refuted` rows as closed unless you disprove the refutation.
3. `docs/stabilization/IRIS-REPORT-20260923-DEEP.md`: evidence.
4. `/Users/bayou/Projects (Code)/Dobius/dobius-plus/dobius/AGENTS.md`, `/Users/bayou/Projects (Code)/Dobius/dobius-plus/dobius/package.json` (real script names).

Re-open source files whenever a task needs exact locations. **Don't rely only on Run A's summaries.**

## Task: write these files in `docs/stabilization/`

### 1. `BASELINE.md`

A plan for Phase 0, the freeze and baseline. Describe the steps; don't execute them. It must:

- Record facts that are already known:
  - installed app 2.0.0, from commit `8841a218` (an rc.1 commit plus uncommitted changes)
  - HEAD `7196dd82` on `fix/channel-cost`
  - Node 22 on this machine vs Node 24 wanted by the repo
  - typecheck passes
  - lint fails with 3,625 errors
  - agents paused
  - Asana Auto Mode off
  - Kanban auto-dispatch, Voice Conductor, Jarvis and the iMessage bridge ON
- List the commands a human or agent should run to capture the rest (tests, build without install).
- Say where data snapshots go: `~/Backups/dobius-stabilization-<date>/`, **never inside the repo**, because they contain secrets.

### 2. `PHASES.md`

Group the work into phases by **engineering dependency and risk**, not by audit heading. Starting point (change it if the code says otherwise):

0 baseline → 1 safety foundation → 2 data integrity → 3 agent runtime → 4 orchestration + automation → 5 remote/phone/iMessage → 6 voice → 7 UI behavior → 8 build + release → 9 config + docs → 10 full regression

For each phase:
- **Goal**
- **Exact bug IDs** (no ranges unless every ID in the range is included)
- **Root cause**
- **Files/components** (path:line from the repo)
- **Tasks**, each with files, changes, tests, dependencies and risk
- **Verification**
- **Exit criteria**

Notes for specific phases:
- **Phase 1 "global execution control":** design one gate that every autonomous start path must pass:
  - Kanban dispatch
  - Voice Conductor
  - Asana Auto Mode
  - heartbeats
  - automations
  - RPC `agent.run`
  - CLI
  - iMessage

  It must **fail closed**. State explicitly whether the gate should consult ADAM's context handshake (X12) now or later, and why.
- **Phase 8:** include Carson's requested **automatic version bump on every build/install**, and the in-app update path (what must change for auto-update to actually work, given the `DOBIUS_SERVICES_DISCONNECTED` / `DOBIUS_ENABLE_DOBIUS_UPDATES` switches and signing).
- **Phase 9:** include a **generated per-session WORKSPACE.md** requirement. Every terminal and agent session should get a detailed workspace description. Sketch where it's generated from (ADAM context pack + a feature map) and where it lives: `CLAUDE.local.md` for Claude, the AGENTS.md mechanism for Codex. Keep it a plan item; no build details beyond one task outline.

### 3. `DEPENDENCY-GRAPH.md`

A Mermaid graph of the real dependencies between clusters and builds, based on repository evidence.

### 4. `EXECUTION-ORDER.md`

`BUILD-001 … BUILD-NNN` in exact order. Each build lists:
- bugs
- depends-on
- files
- the test that proves it
- rollback note

Rules:
- Each build should be small enough for one review and one commit series (rule of thumb: at most about 8 bugs, one architectural concern).
- **No build may mix inherited-engine changes with Dobius+-layer changes.** Mark engine builds `Upstream`.
- **Every bug 1–123 appears in exactly one build.** X-items are either assigned to a build or explicitly deferred with a reason.

### 5. `BRANCH-PLAN.md`

- Branch per build or per phase, named `stabilize/NN-<slug>`, based on `stabilize/iris-20260923`.
- For each: bugs, dependency, expected files, tests, merge criteria.
- Mark which branches **can** run in parallel (disjoint files) and which **must not**.
- Parallel branches use separate worktrees under `.claude/worktrees/`.

### 6. `TEST-PLAN.md`

A testing ladder: **unit → integration → failure injection → E2E**. Use the repo's real test setup (vitest via `pnpm --dir dobius test`, Playwright e2e if present; check `dobius/package.json` and `dobius/tests`).

Failure injection must cover:
- corrupt, partial and missing files
- bad file permissions
- ADAM offline
- Codex missing from PATH
- Claude failure
- phone replay
- duplicate events
- crash mid-run
- backup corruption

### 7. `SAFETY-GATES.md`

Real gates, each listing the exact bug IDs that must be fixed before it:
- **A:** app safe to launch, all autonomy off
- **B:** local manual agents
- **C:** automations / Asana / Kanban auto-dispatch
- **D:** voice conductor / iMessage
- **E:** phone / remote
- **F:** release packaging and auto-update

For each gate, list which settings Carson should flip to turn that capability back on.

### 8. `OBSERVABILITY.md`

Where Dobius fails silently today (with path:line) and the one structured error/event shape to adopt:
- timestamp
- component
- operation
- run/task id
- severity
- recoverable
- cause

Never log secrets.

### 9. `BUILD-001.md`

A full implementation spec that a coding agent can execute without rediscovering anything:
- exact files and lines
- the change
- the tests to add (file names)
- the verification commands
- rollback
- what a reviewer must check

## Rules and guardrails

- **Planning only.** Write only the files above, inside the working directory. No source edits anywhere.
- **Never run:** builds, installs, `build-and-install.sh`, `scripts/install-*`, app-launching tests, `pnpm install`, `git commit`/`push`/`checkout`/`stash`/`reset`, process start/kill, network calls.
- **Allowed:** `rg` (only directly on the command line), `grep`, `sed -n`, `cat`, `ls`, `wc`, `stat`, `git log`/`show`/`blame`.
- **Never read secret file contents** (`*token*`, `.env*`, `auth.json`, `service-token`, `*.enc`, device/keypair/environment JSON, `~/.claude/.credentials*`).
- **By design, never plan to change:** C2 (Jarvis applies its own edits), C3 (Jarvis voice → terminal input). Only allowed: rewording the self-edit footer text.
- **iMessage → terminal stays.** Plan a guard.
- **Don't:**
  - delete or silently reset user data
  - silently regenerate keys or identities
  - fail open
  - let the renderer bypass authorization
  - store secrets in plain text
  - install before validating the replacement
  - redesign the UI
  - add product features beyond the version bump and WORKSPACE.md items above
  - rewrite the app
- **Prefer one tested abstraction** where several bugs share a root cause, and nothing more. Every new abstraction must be justified by specific bug IDs.
- **Priority when ordering:**
  1. remote control
  2. secrets
  3. irreversible data loss
  4. filesystem isolation
  5. runaway autonomy
  6. recovery
  7. agent/orchestration correctness
  8. voice
  9. visible functionality
  10. release tooling
  11. cleanup
- **Save each file as soon as it is done.** If you run low on room, save EXECUTION-ORDER.md, SAFETY-GATES.md and BUILD-001.md first.

## Return format (final message is data, not chat)

1. **Executive diagnosis**: at most 8 bullets on why these bugs accumulated.
2. **Phases table**: phase, goal, bug IDs, depends on, risk.
3. **BUILD list**: BUILD-NNN, name, bugs, depends on.
4. `BUG COVERAGE: n / 123`, plus any missing IDs.
5. **Critical path** (sequential chain).
6. **Parallel-safe work.**
7. **Safety gates summary.**
8. **Branch merge order.**
9. **Decisions for Carson**: things only he can decide (e.g. whether phone control stays enabled, whether Edith/Watson stay on Codex, whether the current pause was intentional). Each gets your recommended default.
10. The line `START HERE: BUILD-001`, followed by a 5-line summary of it.

## If blocked

If something can't be determined from the repository, write `UNDETERMINED: <what> — <why>` in the relevant file and continue. Never invent file paths or line numbers.
