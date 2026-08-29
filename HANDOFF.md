# HANDOFF — Adam control build

Last updated: 2026-08-29 (build start)

> The previous contents of this file described the June v1.0.22 crash fixes and
> were two months stale. Recoverable from git history if needed.

## Current state

Autonomous build in progress on branch `feat/adam-voice-control`, worktree
`/Users/bayou/Projects (Code)/dobius-adam`.

Specification: `AUTONOMOUS-BUILD.md` (authoritative) and
`plans/TASK-ADAM-CONTROL.md` (design rationale). Both were revised on
2026-08-29 after a pressure test; where they disagree, the build file wins.

**Starting point:** commit `640e064d`, tree clean, build green (exit 0),
scoped test baseline 221 passing.

## If you are a resumed agent, read this before anything else

1. Re-read `AUTONOMOUS-BUILD.md` in full. Your context was lost; its hard rules
   and the two security invariants are not optional.
2. **The repo has 566 pre-existing test failures across 542 files.** They fail
   on this branch's base commit and are unrelated to this work. Do NOT fix them.
   Your only test gate is:
   `npx vitest run src/main/jarvis src/main/window src/renderer/src/components/jarvis`
   → 221 baseline + your new tests, with exactly one expected failing file
   (`attach-main-window-services.test.ts`).
3. Never touch `/Users/bayou/Projects (Code)/Dobius/dobius-plus` — another
   agent has uncommitted work there.
4. Check `git log --oneline` to see which tasks already committed, and resume
   from the first one that has not.

## Task status

| Task | State |
|---|---|
| TASK-ADAM-1.1 shell classification | **implementation on disk, UNCOMMITTED** — see below |
| TASK-ADAM-1.2 shell execution + window approval | not started |
| TASK-ADAM-1.3 shell IPC + tool registration | not started |
| TASK-ADAM-2.1 model-writable memory | not started |
| TASK-ADAM-3.1 proactive engine | not started |
| TASK-ADAM-4.1 plugin loader | not started |
| TASK-ADAM-4.2 ElevenLabs tool sync | not started |
| TASK-ADAM-4.3 generic plugin dispatch | not started |

## Resuming TASK-ADAM-1.1 — do not start it from scratch

A first run was stopped early (the gate script was broken; replaced in
`98c92296`). It had already produced good work, which is on disk UNCOMMITTED:

- `plans/TASK-ADAM-1.1.md` — the plan. It correctly namespaces to `ADAM-` and
  found a hole the spec missed: a binary containing `/` must not inherit an
  allowlist entry by basename, or `/tmp/evil/ls` passes as `ls`.
- `dobius/src/main/jarvis/shell-tool.ts` (212 lines)
- `dobius/src/main/jarvis/shell-tool.test.ts` (200 lines)

Verified by hand at the time of the stop: **61 tests passing, oxlint clean,
both tsgo configs clean.**

So TASK-ADAM-1.1 needs only its remaining cycle steps: REVIEW (re-read both
files, write `plans/TASK-ADAM-1.1-REVIEW.md`, fix at least one thing), COMMIT,
GATE (`bash scripts/verify-adam-task.sh 1.1`), LOG. Read the existing files
first — do not rewrite them.

## For Carson, when this finishes

Install manually, THEN grant Accessibility + Screen Recording to
"Dobius+ Computer Use". Installing after granting voids the grant.
