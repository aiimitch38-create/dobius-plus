# Overnight queue, 2026-11-22 (Carson asleep: "go as far as possible with the full build plan")

Rules for the night: same pipeline (worktree per item, engineered brief, Codex review, merge, typecheck + targeted tests, push to fork only).
NOT tonight, needs Carson: install, live voice test call, the OpenAI key, the Hermes restart + yolo flip, any delete or decision row.

## In flight at the start of the night
- Live voice call (wb/live-call): Codex round 2 fixes (money safety)
- 9.8 batch C (wb/cli-batch-c): final Codex fixes
- Bug auto-fix (wb/bug-autofix): resolving merge conflicts + hibernation resume override
- 9.8 batch D (wb/cli-batch-d): ADAM, usage, settings, app services
- 9.8 batch E (wb/cli-batch-e): board cards, loops, snapshots, tab snooze

## Next, in order, as slots free (max 5 at once)
1. 1.1 Port "Report a problem" + 5.1/5.2/5.4 bug button (pick mode, capture, stable names); feeds the merged auto-fix (5.3/5.5)
2. 1.6 Port fixes: auto-resume, links open in the browser, blank window recovery
3. 1.7 Port release safety checks
4. 1.8 Port Agent Pre-Flight Primer (branch aiimitch38-create/agent-preflight-primer, local-only commit f1378da3)
5. 1.5 Chat improvements: fold older turns, answer question cards in Chat
6. 7.6 hook install status + 7.7 usage detail table + 7.5 cloud job buttons (small UI trio)
7. 0.6 + 0.7 dead Channels chains + stale allowlist entries
8. 9.8 last step: SKILL.md + coverage test (after A-E merged)
9. 6.1-6.5 Telegram bot bridge
10. 3.1-3.4 agent briefing + loading screen
11. 4.1-4.4 graph refresh, lesson write-back, grader agent, vault note
12. 1.2 Phone mode, 1.3 iPhone share sheet, 1.4 Team linking + Windows (large)
13. 7.1 Knowledge page, 7.3 per-tab checklist, 7.4 run adoption gate, 2.2 event log + proof of done
14. 8.x (replay tests, skill cleanup, Gmail intake, Command Center), 7.2 Laya: need Carson's design answers first, so research only

## Done tonight
(appended as items merge)
- Bug auto-fix merged (9aa09b10): bug card on Kanban starts a restricted Claude fix agent; restricted on every relaunch/resume/wake path
- Started: 1.1 + 5.1/5.2/5.4 bug button (wb/bug-button)
- 9.8 batch C merged (c8db0350)
- Started: 1.6 port fixes (wb/port-fixes)
- ADAM live voice call merged (6d77261e): ready for Carson's test call (needs his OpenAI key)
- 1.6/1.7 port fixes merged (e8347435)
- 0.6/0.7 found already done (e960c7ce), plan just unmarked
- 9.8 batches D and E built, in Codex review
- Started: 1.8 Pre-Flight Primer, 1.5 Chat improvements, 7.5-7.7 UI trio
- Disk dropped to ~1.8 GB; agents told to run targeted tests only
- 9.8 batch E merged (634aee9d): board cards, loops, snapshots, tab snooze from the CLI
- 9.8 batch D merged (273d8540): ADAM, usage, knowledge, backup, settings, accounts (switch gated) from the CLI
- Bug button agent stopped at Carson's request (existing button is enough)
- 1.8 Primer: Codex round 2 fixes in progress
- 1.5 Chat improvements merged (32155645): fold older turns, blue user box, type an answer to a card, open pasted images, transcripts stay on. To check live: does picking a card option pick the right one?
- 1.8 Pre-Flight Primer merged (3121d8d2): every new terminal tab's brief carries git, other tabs, lesson headings, MCP names, spend
- INSTALLED 2.3.6 (build 79, commit 18e6f3c1, clean) with Carson's OK + take-over; rollback copy of 2.1.9 kept. Carson testing live.
- Next update: wb/ui-trio (7.5 cloud job buttons, 7.6 hook status; 7.7 already covered by Settings > Stats)
- INSTALLED 2.3.8 (build 81, commit c76739d7): orb follows Settings changes, voice errors toast + live-voice-errors.log. Next update: Codex P2 log hardening (bc23e47b on wb/voice-press-fix)
