# TASK-02: Delete the ~42 unreachable Channels files
What: delete files under renderer/src/components/communications/features/** with no importer. Why: dead code costs reading time for every agent and every review.
Simplification: re-run an import-reachability check per file right before deleting; delete only zero-importer files. Approved scope = Channels files only. Other orphans (Operations dashboard, UsageSessionsTable, comms identity IPC, chat projections, legacy dialogs) need a separate OK.
Acceptance: each deleted file had 0 importers (list saved in the task review); typecheck + tests + build exit 0.
Estimate: 1-2 h (estimate).
