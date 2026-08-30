# HANDOFF — Local voice engine build

Last updated: 2026-08-29 21:15 (build start)

## Current state

Autonomous build starting on branch `feat/adam-voice-control`, worktree
`/Users/bayou/Projects (Code)/dobius-adam`. Specification:
`AUTONOMOUS-BUILD.md` (the local-voice-engine build — NOT the completed Adam
control build, whose record lives in BUILD-LOG.md and git history).

Starting point: Adam control build complete and installed (all 8 ADAM tasks
verified, 476 tests passing in the voice scope). ElevenLabs credits
exhausted — that is WHY this build exists.

## If you are a resumed agent

1. Re-read `AUTONOMOUS-BUILD.md` in full — hard rules, security invariants,
   pinned baseline (476 passing / 1 known failing file), pinned model URLs.
2. Do NOT run the broad test suite; 566 unrelated failures exist outside the
   scope. Gate: `bash scripts/verify-voice-task.sh N.N`.
3. Check `git log --oneline` for committed TASK-VOICE tasks; resume at the
   first uncommitted one.
4. Never touch `/Users/bayou/Projects (Code)/Dobius/dobius-plus`.

## Task status

| Task | State |
|---|---|
| TASK-VOICE-1.1 local TTS engine module | DONE (486 passing, gate green) |
| TASK-VOICE-1.2 bake-off + speak routing | DONE (501 passing, gate green) |
| TASK-VOICE-2.1 streaming brain seam | DONE (523 passing, gate green) |
| TASK-VOICE-3.1 VAD endpointing + barge-in | DONE (542 passing, gate green) |
| TASK-VOICE-4.1 wire loop + settings UI | not started |
