# TASK-06: Check after finishing, then retry
What: after an agent run ends, run the project's check command; on failure resume the same session with the output, max 3 rounds, then mark Blocked (never Completed).
Simplification: store the check result on the existing run record (agent-runs-store) instead of building the unified event bus. Reuse main/automations/precheck-runner.ts for running the command; resume already exists at agent-runner.ts:387.
Acceptance: test with a fake check that fails twice then passes = 3 rounds, Completed; always-failing check = Blocked after 3; a run without a configured check behaves exactly as today.
Estimate: 1-2 days (estimate).
