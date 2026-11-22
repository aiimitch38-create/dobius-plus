# PORT: Snooze tabs

Status: REALLY MISSING (grep of `dobius/src` for "snooze" finds only Linear skill reminders and the Communications reminders panel, none of it for terminal tabs or workspaces).

## What it does for the user
Right-click a tab and choose Snooze, then a time: Tonight, Tomorrow morning, 24 hours, 2 days, Next week, or Until I bring it back. The tab closes (its terminal stops, so it costs no memory) and waits in a folded "Snoozed" shelf in the sidebar under its project. When the time comes it reopens, marked unread, and resumes its Claude conversation. Right-click a snoozed row for Bring back now, Snooze until, or Close for good.

## Sam's source (repo `statusdigitalmarketing/dobius-plus`, JavaScript app)
- No PR; direct commits. Feature commit `0c8a53e1` "Snooze tabs into a sidebar shelf; Terminal/Chat switches the whole window", merged by `9bc62fda`. Asked for by Brett (Asana 1220362133877230).
- Follow-ups: `1ee819a0` (Windows: snoozed tabs keep output), `6e28e523` (phone demo wake times), `71becaa6` / PR #11 (longer wait in Windows smoke test).
- His files: `electron/tab-snooze.js` (main-side list, 100-entry cap, one timer capped at 6h, `take()` hands an entry out once), `electron/__tests__/tab-snooze.test.mjs`, `shared/snooze-times.js` (pure time picks, easy to copy), `src/hooks/useSnoozeReturn.js`, `src/components/Project/TerminalTabBar.jsx` (menu), `ProjectTabsView.jsx` (shelf), `src/store/store.js`, `electron/main.js` + `preload.js` (IPC).
- Lessons from his review (carry over): resume must go through the session-claim gate or the tab comes back as a plain shell; a tab closed mid-save must not keep its entry; Bring back now must work before tabs are restored; pinned tabs must come back pinned; Windows needs old output scrolled into scrollback before the new prompt.
- Accepted flaw on his side: a timed return goes to whichever window of the project asks first.

## Where it fits in THIS app (all under `dobius/src`)
- Menu: `renderer/src/components/tab-bar/SortableTabContextMenu.tsx` (add a Snooze submenu next to Close; it already uses `DropdownMenuItem`).
- Tab strip and close logic: `renderer/src/components/tab-bar/TabBar.tsx`.
- Shelf in sidebar: `renderer/src/components/sidebar/` (worktree rows live here; add a folded Snoozed group per worktree).
- Persistence: `main/persistence.ts` (settings and state file) and `main/terminal-scrollback-snapshots.ts` (already stores terminal output; reuse for the 200 saved lines).
- Terminal launch/resume: `main/ipc/pty.ts`, `main/ipc/pty-management.ts`.
- Pure time picks: new `shared/snooze-times.ts`, ported from Sam's file with types. Compare `renderer/src/components/communications/features/reminders/lib/timePresets.ts`, which already does "9am tomorrow" math for reminders; reuse its helpers rather than copying twice.
- New: `main/tab-snooze.ts`, IPC in `main/ipc/`, preload bridge in `preload/`, store slice in `renderer/src/store/slices/`.
- Note: this app has worktrees and agent tabs, not Sam's "project windows". Snooze must key on worktree id + tab id.

## Port steps
1. S. Port `snooze-times.js` to `shared/snooze-times.ts` with a vitest copy of his date tests (fixed `now`).
2. M. Main service `main/tab-snooze.ts`: list in persisted state, cap 100, metadata only, scrollback via existing snapshot store, single timer, `take(onlyReady)` so two windows cannot both get an entry. Port his test file.
3. M. IPC channels plus preload types (snooze, list, bringBack, closeForGood, ready-event). Typecheck node and web.
4. M. Renderer store slice: snoozed entries per worktree, hide rows for tabs that just left (his sidebar fix).
5. M. Context-menu Snooze submenu in `SortableTabContextMenu.tsx`; confirm dialog if the tab is mid-work.
6. M. Sidebar Snoozed shelf, folded by default, open state remembered in settings; row menu (Bring back now, Snooze until, Close for good).
7. L. Return flow: reopen tab unread, restore scrollback, resume the agent session through the same claim gate the History/auto-resume path uses. This is the risky step; study how `main/ipc/pty.ts` resumes sessions first. Preserve pinned state.
8. S. Windows scrollback fix (only if Windows is supported by this build).
9. S. i18n strings in `renderer/src/i18n/locales/en.json` (other locales can fall back).

Total: L (about 2 to 3 working days).

## How to test in the dev copy
Use the isolated dev copy only (never the live app). Open a project, start Claude in a tab, right-click, Snooze, "24 hours". Check: tab closes, shelf appears folded under the worktree, restart the dev copy and the shelf is still there. Use "Until I bring it back", right-click row, Bring back now: tab reopens unread with old output and the same conversation. Temporarily add a 1-minute pick (dev only) to watch a timed wake. Test two windows on one project: only one gets the tab. Screenshot each state in a fresh window.

## Open questions for Carson
1. Should it also snoozes browser and editor tabs? Recommended: terminal/agent tabs only first.
2. Use this app's existing "sleep" idea (`agent-status` manual sleep) or a separate shelf? Recommended: separate shelf, same as Sam, so the two features do not tangle.
3. Time picks: copy Sam's exact list (9 PM tonight, 9 AM morning)? Recommended: yes.
4. Phone/mobile wake notification? Recommended: not in v1.
