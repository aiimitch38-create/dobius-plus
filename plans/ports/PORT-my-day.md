# PORT: My Day (the "Today" short list)

Status: REALLY MISSING as Sam built it. Nothing in `dobius/src` matches "my day", "today list", or SamKnows. Nearby pieces exist but do different jobs (see below). Warning: Sam's version is wired to his Inbox board and the SamKnows service, neither of which exist in this app, so this port needs a data-source decision first.

## What it does for the user
A short list of up to 15 things worth finishing today, each with a one-line reason why Claude picked it. Each item can be marked Done or snoozed (tomorrow, next week). Snoozed items wake when their time is up, when the card changes, or when the due date arrives. It never says "all clear" unless every source answered. It tells you plainly when a source is down. Everything stays on this computer.

## Sam's source (repo `statusdigitalmarketing/dobius-plus`, JavaScript app)
- No PRs; direct commits on `feat/my-day`, `fix/today-reader-limits`, `feat/today-claude-pick`, `feat/phone-today`.
- `ee372858` first step (merged `662bfb30`), design doc `docs/my-day.md` (read this first, it records what Codex cut and why).
- `c404cb0d` read SamKnows only from the user's own listener.
- `22f7bb8d` Claude picks the list with reasons, plus snooze (merged `8af38213`).
- `11599fdb` and follow-ups: Today on the phone and Today alerts (counts only, never card text).
- His files: `electron/today.js` (rules, board reader), `electron/today-pick.js` (headless Claude pick, JSON-only answer cut to known ids), `electron/today-snooze.js`, `electron/today-nudge.js`, `electron/inbox-board.js`, `src/components/shared/TasksDropdown.jsx`, tests `today.test.mjs`, `today-pick.test.mjs`, `inbox-board.test.mjs`.
- Costs he measured: about $0.17 per pick run on 208 cards; runs once a day and when cards change and the pick is 3 hours old.

## Where it fits in THIS app (under `dobius/src`)
Already here, do not rebuild:
- `renderer/src/components/right-sidebar/TasksPanel.tsx`, `main/asana/asana-queue-service.ts`, `shared/asana.ts`: Asana lanes (build/review) with done/requeue. This is the closest match to a card source.
- `renderer/src/components/board/board-home/BoardHome.tsx` and `home-greeting.ts`: a home surface with a greeting, the natural place for a My Day card.
- `renderer/src/components/board/cards/CalendarCard.tsx`, `ChecklistCard.tsx`, `kanban/KanbanBoard.tsx`: other possible sources.
- `renderer/src/components/agents/AgentBriefingCard.tsx` and `agent-briefing-count.ts`: an existing "briefing" card; check overlap before adding anything.
- `renderer/src/components/communications/features/reminders/`: reminders with snooze presets (reuse the snooze logic from `lib/timePresets.ts`).
Missing and to be built: a source reader, the Claude pick, and the Today card.

## Port steps
1. S. Decide the source (Open question 1). Write a one-page contract: what a "card" is (id, title, due, priority, source, updatedAt).
2. M. Main reader `main/my-day/sources.ts` that returns cards from the chosen source(s) and reports per-source health (ok, down, unreadable, stale). Cap what it reads; treat all text as untrusted.
3. M. Rule list `main/my-day/rank.ts`: port Sam's `bucket` logic (today, recent overdue, undated, not due) as the fallback, deterministic, with total/otherCount so nothing is hidden silently. Port `today.test.mjs`.
4. M. Snooze store `main/my-day/snooze.ts`: local only, wakes on time, on change of card, on due date. Snooze applies only to the card as main last saw it. Port his tests. Reuse time presets from Step 1 of PORT-snooze-tabs if that ships first.
5. L. Claude pick `main/my-day/pick.ts`: headless, no tools, no saved session, JSON answer cut to known ids plus a short reason; one run at a time; kill the process group if stuck. Needs the app's existing headless Claude launch path (look in `main/claude/` and `main/agents/`). Hard cap on cost; show cost in dev.
6. M. IPC + preload + store slice.
7. M. UI: a My Day card on `BoardHome.tsx` and a section in `TasksPanel.tsx`: list with reason, Done, Snooze, Bring back, See all, "n snoozed", source-health lines.
8. S. Optional later: daily nudge with counts only (Sam's `today-nudge.js`).

Total: L to XL (about 4 to 6 days), dominated by steps 2 and 5. A rules-only v1 (skip step 5) is M to L.

## How to test in the dev copy
Use fake cards first (a fixture file), never real mail or board data. Check: 15 cap and the "n more" count; stop the source and see the "source is down" line instead of "all clear"; snooze a card, change it, see it wake; run the pick with fixture cards and check reasons only name real ids; kill the pick mid-run. Then connect real Asana in the dev copy only if Carson approves. Screenshot BoardHome and TasksPanel in a fresh window.

## Open questions for Carson
1. Where do My Day cards come from here? Sam's Inbox board and SamKnows are not in this app. Recommended: start with Asana (already connected via TasksPanel) plus the board checklist cards; leave SamKnows out.
2. Should Claude pick the list (costs about $0.17 per run in Sam's numbers)? Recommended: rules-only first, add Claude pick after you have seen the rule list.
3. Should it apply to the whole team or only you? Recommended: only you; data stays on this computer, as Sam decided.
4. Daily alerts (Mac notification, iMessage)? Recommended: skip in v1.
