# TASK-03: Install ADAM's 4 missing command wrappers
What: add /tabSendTo, /tabFocus, /tabRead, /tabOpen to the wrapper list in main/dobius-cli/install-clis.ts:140-167 (routes exist at dispatch-server.ts:298-310).
Simplification: extend the existing list; copy an existing wrapper entry. No new mechanism.
Acceptance: after install, each wrapper exists on PATH and returns a non-error against the running bridge; existing 4 wrappers unchanged.
Estimate: 30 min (estimate).
