# TASK-12: Lesson write-back for SDK agent runs only
What: after a run whose postcheck failed at least once, a cheap model writes one deduped lesson line to that agent's memory.md (capped length).
Simplification: terminal sessions already have the global learn loop (73 learned skills); this covers only SDK runs, which skip user hooks (agent-runner.ts:433). Reuse the Haiku pattern in agent-heartbeat-service.ts:18.
Acceptance: test: failed-then-passed run appends exactly one line; same failure twice does not duplicate; memory.md stays under cap.
Depends on TASK-06. Estimate: 0.5-1 day (estimate).
