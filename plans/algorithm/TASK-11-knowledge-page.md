# TASK-11: Knowledge page showing the project graph
What: add the 'knowledge' branch in AppWorkspaceShell.tsx:296-306 plus a nav entry; show knowledge tree (backend exists: main/ipc/knowledge.ts:72-75) and open graphify-out/graph.html for the current project.
Simplification: show graphify's own graph.html (in the built-in browser pane or a webview) instead of writing a graph renderer.
Acceptance: screenshot of the page with the Dobius graph loaded; page says "no graph yet, build one" when graphify-out is missing.
Estimate: 1 day (estimate).
