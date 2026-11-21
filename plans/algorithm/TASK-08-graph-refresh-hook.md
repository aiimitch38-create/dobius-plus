# TASK-08: Refresh the graph after each commit
What: use graphify's own post-commit hook (~/.claude/skills/graphify/references/hooks.md) running `graphify update` (code-only, no AI cost).
Simplification: native git hook from the tool, no app code. Install per repo only with Carson's OK (it changes git hooks; husky is in this repo, so chain it there).
Acceptance: commit a change, graph.json mtime is newer than the commit; a commit that would shrink the graph is refused, not forced.
Estimate: 30 min (estimate).
