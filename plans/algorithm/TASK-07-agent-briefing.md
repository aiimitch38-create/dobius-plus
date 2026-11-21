# TASK-07: Agent briefing (replaces "port the primer" + loading screen + design-system section)
What: fill the stub ADAM context-pack provider at main/agents/session-workspace-brief.ts:46-64 and add the brief to SDK runs via agent-run-prompt.ts. Sections: lessons (top N relevant), graph (GRAPH_REPORT trimmed + `graphify query <task>` budget 1500), design system (PATH to dobius/design README/tokens, only for UI tasks), MCP names, other tabs in the project. Freshness stamp per section.
Simplification: this app already generates the workspace brief (CLAUDE.local.md); extend it instead of porting electron/agent-preflight.js. Loading screen = a one-line "Briefed: lessons / graph / design" status in the tab, not an animated screen, unless the brief takes >1 s.
Acceptance: a new tab's CLAUDE.local.md and an SDK run's prompt both contain the sections; total under 16 KB; build exit 0; screenshot of the status line.
Estimate: 1-2 days (estimate).
