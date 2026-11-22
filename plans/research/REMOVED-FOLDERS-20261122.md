# Old folders removed 2026-11-22 (Carson's OK)

Only the working folders were removed. Every branch and commit is still in the repo (`~/Projects (Code)/Dobius/dobius-plus/.git`). To get a folder back: `git -C ~/Projects\ \(Code\)/Dobius/dobius-plus worktree add <folder> <branch>`.

None had uncommitted changes. Lost on removal: only build output (dist/, dist-electron/, dist-mobile/), Playwright scratch (.playwright-mcp/), and each folder's generated CLAUDE.local.md brief.

## Updates

- Branch: `Updates`, last commit `abddb295` (2026-11-02)
- On a remote (GitHub): yes, all commits
- Commits not in the workstation build: 758

Last 15 commits:

- `abddb295` 2026-11-02 2.1.7
- `76209ba0` 2026-11-02 Merge branch 'feat/inbox-tasks'
- `85986792` 2026-11-02 Merge branch 'fix/resume-real-cwd'
- `41237f36` 2026-11-02 Merge branch 'fix/keys-any-window'
- `688155ca` 2026-11-02 Resume fix: wire the project-cwd tests into npm test; realistic cwd in the session-cache fixtures
- `e3139c8e` 2026-11-02 Merge branch 'fix/opentab-claude-name'
- `fd4a6d80` 2026-11-02 Resume: each session's real folder comes from its transcript, not a guess
- `c9b4d7d3` 2026-11-02 Shared keys save from any Dobius window; app windows never leave Dobius
- `eb029dd3` 2026-11-02 /openTab: recognise Claude started by name (Brett's card)
- `dd85d22f` 2026-11-02 Inbox: hide without a board, Start board, live refresh; Settings in the app menu
- `aace1ca9` 2026-11-02 Inbox board: send the token only to our own 127.0.0.1 listener
- `60eff8b2` 2026-11-02 Tasks dropdown: Inbox board segment, richer project tasks
- `a16f77d7` 2026-11-02 2.1.6
- `8bc8589a` 2026-11-02 Merge branch 'fix/restore-windows'
- `c7e7b6dd` 2026-11-02 Merge branch 'feat/background-wait'

## UI-UPDATES

- Branch: `aiimitch38-create/UI-UPDATES`, last commit `7cac7d96` (2026-11-08)
- On a remote (GitHub): yes, all commits
- Commits not in the workstation build: 401

Last 15 commits:

- `7cac7d96` 2026-11-08 Merge fix/bughunt-20261027: 2026-10-27 bug-fix sweep
- `c1b3e4b1` 2026-11-08 docs: add bug-hunt handoff notes and Iris investigation report
- `b3cca4d0` 2026-10-27 docs: log the 2026-10-27 bug-fix sweep in BUILD-LOG.md
- `737d4a1e` 2026-10-27 fix: drop dead Kanban preview fallback, clear stuck drag-over highlight
- `0142b019` 2026-10-27 fix: Costs tab crash on undefined projectName, close git-service path trap
- `872533f9` 2026-10-27 fix: Tasks panel/Kanban stage desync and stale Search response race
- `bf81f795` 2026-10-27 fix: gate checkpoint, filewatcher, and voice-bridge /stage on isKnownProject
- `0ef10774` 2026-10-27 fix: don't destroy a sibling browser tab when a tear-off window docks
- `72f76915` 2026-10-26 1.0.82
- `6c2aab82` 2026-10-26 Merge tab docking: put a torn-off tab back into the main window
- `04a69c28` 2026-10-26 Tabs: refuse a tear-off from a window that is already closing
- `9c699cc1` 2026-10-26 Tabs: a tear-off drops the tab from its source's saved list; checks the asking window's project
- `8a77cd3b` 2026-10-26 Tabs: an in-flight tear-off survives its source closing; ids must name their project
- `372806ee` 2026-10-26 Tabs: a tab mid-dock may load its scrollback
- `95ec7f91` 2026-10-26 Tabs: dock records restore on their own, survive a failed claim after the source closed

## agent-preflight-primer

- Branch: `aiimitch38-create/agent-preflight-primer`, last commit `f1378da3` (2026-11-14)
- On a remote (GitHub): NO: 1 commit(s) exist only locally, listed below
- Commits not in the workstation build: 1116

Last 15 commits:

- `f1378da3` 2026-11-14 Task 10-agent-preflight: agent pre-flight primer for new tabs
- `b687eecf` 2026-11-14 2.2.33
- `472ac72e` 2026-11-14 Report a problem from the status bar (#18)
- `bedaa231` 2026-11-14 Sidebar Tabs list: double-click does nothing (Brett, Asana 1220545658471567) (#19)
- `572717fd` 2026-11-14 Phone mode: drive a tab's Claude from the phone with real questions and permissions (#12)
- `125016cb` 2026-11-14 Lessons: the Mac wording in release notes (#17)
- `fe242b7a` 2026-11-14 Release notes: say the computer, not the Mac (#16)
- `a63f5cfb` 2026-11-14 2.2.32
- `b0f69401` 2026-11-14 Test: stripAnsi timing budget follows machine load (#15)
- `bab3cb07` 2026-11-14 What's new for 2.2.32
- `96e7e8f2` 2026-11-14 Updater: no lasting red banner when an automatic check runs offline (#14)
- `70b219fd` 2026-11-14 2.2.31
- `45cac7d6` 2026-11-14 Merge pull request #13 from statusdigitalmarketing/fix/resume-stamps-at-launch
- `dc9dac76` 2026-11-14 Auto-resume (Codex round 12): any Claude seen in the tab, named or not, at a capture or at quit, retires its launch resume, and a retired resume is never queued or written after its preparation
- `909722f3` 2026-11-14 Auto-resume (Codex round 10): idle evidence is dated by when the tab was probed, and an unknown quit probe for a session seen stopped clears it as soon as it returns

Local-only commits:

- `f1378da3` 2026-11-14 Task 10-agent-preflight: agent pre-flight primer for new tabs

