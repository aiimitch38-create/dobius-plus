# TASK: Board "A" menu — hover open, Restart, Reset board

Requested by Carson 2026-11-21.

## What
- The round avatar ("A") button at the right of the Board top bar opens its menu on **hover** (click still works).
- **Restart Dobius+** always shows in that menu (today it hides behind Option-click). Same `app:restart` IPC: daemon checkpoints flush, then relaunch.
- New **Reset board**: clears the CURRENT workspace's board — every console (terminal is closed), every web tile, note, and every other card, group, and connector. Other workspaces untouched.
- Reset asks first with a destructive confirm pop-up that names how many consoles are still running.

## Why
Carson wants one place for account / restart / reset, opened by hovering the avatar.

## How (reuse, no new IPC)
- `board-route/board-reset.ts`: `boardResetPlan()` (pure, tested) + `closeConsoleCards()` (the close-then-sweep logic lifted out of Kill all, so pinned tabs that refuse to close keep their card) + `resetBoard()`.
- Kill all now calls `closeConsoleCards()` — one copy of that logic.
- `board-chrome/BoardAccountMenu.tsx`: the menu moved out of `BoardTopBar.tsx` (400-line cap), plus hover open/close with short delays.
- `HelpMenuItems` gets `hideRestart` so the board menu doesn't show Restart twice with Option held.

## Test
- `board-reset.test.ts` for the plan.
- Typecheck web, lint, vitest on touched files.
- Isolated test copy: hover opens menu, Reset clears a board with a console + note + web tile, Restart brings tabs back. Screenshot.

## Risks
- Reset kills running agents: guarded by the confirm.
- Hover menus can flicker: open after 120 ms, close 200 ms after the pointer leaves both the button and the menu.
