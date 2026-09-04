# Dobius+ — Autonomous Build Prompt: Communications Hub live bugs (2026-09-04)

## Launch Command (preferred — with supervisor auto-resume)
```bash
cd "/Users/bayou/Projects (Code)/Dobius/dobius-plus"
bash scripts/crackbot-supervisor.sh AUTONOMOUS-BUILD.md
```

## Context

You are fixing 4 real bugs in the Dobius+ Communications Hub (a Slack/Discord-style
chat surface inside this Electron app, built on a local Nostr relay). Carson
(the user) found these live-testing the app tonight. Root cause for all 4 is
already investigated and documented — this is implementation + verification,
not discovery. Read `IRIS-REPORT-20260904.md` at the repo root first for full
evidence and architecture context before starting Task COMMS.1.

**Repo root**: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`
**App source**: `dobius/src/` (NOT the legacy root `src/` — that's dead
vendored code from an old prototype, used only by the `legacy:*` npm
scripts; never touch it).
**Branch**: `feat/computer-use-v2` (current — stay on it, do not create a new
branch, do not touch `main`).

## The 4 tasks — plans already written

Each task's plan file already exists with root cause, exact fix, file:line
evidence, and guardrails. Read the plan file fully before starting that
task's IMPLEMENT step — do not re-derive root cause from scratch.

- `plans/TASK-COMMS.1.md` — channel/DM live view goes silent (highest
  priority; Carson: "that's where everything will really happen")
- `plans/TASK-COMMS.2.md` — agent name must always show (Carson's stated
  #1 concern; do right after COMMS.1, same area)
- `plans/TASK-COMMS.3.md` — Huddle button silently disabled, no explanation
- `plans/TASK-COMMS.4.md` — channel delete needs a direct sidebar entry
  point

Do them **in this order** (1, 2, 3, 4) — COMMS.1 and COMMS.2 touch the same
area and COMMS.2 depends on COMMS.1's context; COMMS.3 and COMMS.4 are
independent and lower severity.

## The cycle — every task, no exceptions

```
PLAN → IMPLEMENT → VERIFY → REVIEW → COMMIT → GATE → LOG
```

For task COMMS.N:

1. **PLAN**: the plan already exists at `plans/TASK-COMMS.N.md` — read it in
   full. If, while implementing, you discover the documented root cause is
   wrong or incomplete, update that same file with what you actually found
   before proceeding — don't silently diverge from a stale plan.
2. **IMPLEMENT**: make the fix. Match existing code patterns in the touched
   file exactly. No rewrites beyond what the plan describes. No unrelated
   refactors, even if you see something else you'd like to clean up — note
   it in the review file instead, don't fix it now.
3. **VERIFY**: write/run the test(s) the plan describes. Then run
   `pnpm --dir dobius run typecheck` — must exit 0. For any task touching
   renderer message rendering or connection logic, also do a live smoke
   test in the running app if it's installed and running (`pgrep -f
   "/Applications/Dobius\+.app/Contents/MacOS"` to check) — the plan's own
   "Test" section says what to check live.
4. **REVIEW**: re-read every file you changed for this task. Write
   `plans/TASK-COMMS.N-REVIEW.md` — what you changed, why, what you tested,
   any risk a human reviewer should double-check. Fix one real thing you
   notice on re-read if there is one.
5. **COMMIT**: `git add` the specific files you changed for this task only
   (never `git add -A`). Commit message must contain the literal string
   `Task COMMS.N` (the gate greps for this). Follow this repo's existing
   commit message style — see `git log --oneline -10` for tone.
6. **GATE**: run `bash scripts/verify-task.sh COMMS.N` — must exit 0 before
   moving to the next task. If it fails, fix the specific failure it names
   and re-run; do not proceed past a failing gate.
7. **LOG**: append an entry to `BUILD-LOG.md` (this file already has
   tonight's earlier entries — match that format) covering what changed and
   why. Update `HANDOFF.md` to describe current state and mention `Task
   COMMS.N` (the gate checks for this). Update `claude-progress.json`
   (`currentTask`, `completedTasks`, `totalTasks: 4`) — this file is stale
   from a much older build; overwrite its content, don't try to reconcile
   with what's there.

If verification fails twice in a row on the same task, append the failure
pattern to `LESSONS-LEARNED.md` (there's a real, actively-used one at the
repo root — read it first, it has directly relevant entries about this
exact project's build quirks) before continuing.

## Guardrails (apply to all 4 tasks)

- No `@ts-ignore` / `@ts-nocheck` / eslint-disable to silence a real type
  error — fix the actual type issue.
- No empty catch blocks.
- No hardcoded hex colors — this app uses CSS variables (see
  `dobius/docs/STYLEGUIDE.md` if any task touches visible UI styling).
- Never `git push`, never open a PR, never touch `main`. Local commits on
  `feat/computer-use-v2` only.
- Never mark anything done in Asana — not applicable here (this work came
  from direct chat, not an Asana task), but the rule stands generally.
- If a task's actual scope turns out much larger than its plan describes
  (e.g. COMMS.1's connection fix reveals a deeper architectural problem),
  stop and write that finding clearly in the REVIEW file and in
  `HANDOFF.md` rather than silently expanding scope — a human decides
  whether to continue.

## Disk space

This machine has hit ENOSPC before during builds tonight. Before each
task's VERIFY step, if `df -h "/System/Volumes/Data" | tail -1` shows under
5GB free, stop and report it in HANDOFF.md rather than continuing — do not
run a full `pnpm --dir dobius run build:desktop` package build as part of
routine per-task verification; typecheck is the gate (see verify-task.sh).

## Definition of done

All 4 tasks committed, each passed its own `verify-task.sh` gate. When all 4
are done, write `BUILD COMPLETE` into `HANDOFF.md` (the supervisor looks for
this exact string to know not to auto-resume again) and stop. Do not build
the full installable app package or install it — that's a separate step the
human does after reviewing the diff, per this repo's Done Bar.
