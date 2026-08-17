# TASK — Floating terminal "Keep on Top" (follows you into Chrome & everywhere)

## What

Give the torn-off (floating) terminal window a right-click menu with a
**Keep on Top** checkbox. When checked, the window:

1. Floats above every other app (Chrome included) — `setAlwaysOnTop(true, 'floating')`
2. Follows across macOS Spaces and full-screen apps —
   `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`

Unchecking turns both off. New tear-offs in the same app run remember the
last choice (module-level variable, same pattern the phone window uses for
its bounds).

## Why

Carson wants the terminal with him while he works in other apps. The
tear-off window already exists but is a plain window — anything clicked
covers it.

## Existing patterns to reuse (do NOT invent new ones)

| Piece | Where |
|---|---|
| Tear-off window creation | `dobius/src/main/window/tear-off-window.ts:59` (`openTornOffTerminalWindow`) |
| Proven always-on-top recipe | `dobius/src/main/window/floating-phone-window.ts:132` + `:141` |
| Native context-menu popup pattern | `dobius/src/main/window/createMainWindow.ts:566-576` |
| Editable-field menu builder (compose with ours) | `dobius/src/main/window/editable-context-menu.ts` (`buildEditableContextMenuTemplate`) |
| In-memory persistence pattern | `floating-phone-window.ts` `persistedPhoneBounds` module variable |

## Steps (all in `tear-off-window.ts`, one file)

1. **Module state**: `let lastKeepOnTop = false` — remembered default for the
   next tear-off this app run.
2. **`applyKeepOnTop(win, enabled)` helper**:
   - `win.setAlwaysOnTop(enabled, 'floating')`
   - `win.setVisibleOnAllWorkspaces(enabled, { visibleOnFullScreen: true })`
   - update `lastKeepOnTop`
3. **In `openTornOffTerminalWindow`**: after window creation, if
   `lastKeepOnTop` → `applyKeepOnTop(win, true)`.
4. **Right-click menu**: `win.webContents.on('context-menu', ...)` →
   `Menu.buildFromTemplate([...])`:
   - `{ label: 'Keep on Top', type: 'checkbox', checked: win.isAlwaysOnTop(), click: toggle }`
   - separator + `buildEditableContextMenuTemplate(params, win.webContents)`
     items when the click target is editable (so we don't steal
     spellcheck/paste from any editable field in that window).
   - `.popup({ window: win, x: params.x, y: params.y })`
5. Detach listener on `closed` (window close already tears down webContents;
   verify no leak with existing patterns — main window uses `.on` with no
   explicit detach because the window owns the contents; mirror that).

No renderer changes. No new IPC. No new dependencies.

## Verification

- `cd dobius && pnpm typecheck` exits 0.
- Unit test (mirror `focus-existing-window.test.ts` mock-window style):
  toggling calls `setAlwaysOnTop(true, 'floating')` and
  `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`; new
  window inherits `lastKeepOnTop`.
- Manual (dev app): tear off a terminal → right-click → Keep on Top →
  click into Chrome → terminal stays visible on top; switch Spaces →
  terminal follows; uncheck → normal window again.

## Pre-mortem (checked against code 2026-07-30)

Cleared — verified NOT problems:
- **Right-click conflict**: `Terminal.tsx` has zero `contextmenu` handlers;
  `SelectedTextCopyMenu` mounts only in sidebar worktree cards, which do not
  exist in the torn-off window; the main-window native handler is
  editable-fields-only. Right-click over a torn-off terminal is currently
  completely unclaimed.
- **Focus pulse fight**: `focus-existing-window.ts:39` `pulseAlwaysOnTop`
  runs only on win32, only for the MAIN window, and skips windows already
  on top. Cannot un-pin us.

Real risks + mitigations:
1. **Full-screen apps**: `'floating'` level may not clear a full-screen
   Chrome Space. Test first in dev; fallback = `'screen-saver'` level.
   Also call `win.setFullScreenable(false)` while pinned (known Electron
   gotcha: a fullscreenable window on all workspaces misbehaves, and the
   green zoom button makes no sense on a pinned floater); restore on unpin.
2. **Accidental close kills the session**: `tear-off-window.ts:127` kills
   the PTY on window close, and a pinned window is easier to close by
   accident. Out of scope to change; note as follow-up (confirm-close or
   return-tab-to-main-window).
3. **Cross-platform**: guard `setAlwaysOnTop(true, 'floating')` and
   `setVisibleOnAllWorkspaces` behind `process.platform === 'darwin'`
   (mirror `floating-phone-window.ts:140`); plain `setAlwaysOnTop(enabled)`
   elsewhere.
4. **Manual testing MUST use the dev build** (`pnpm dev`, separate
   `Dobius+-dev` userData). Do NOT reinstall `/Applications/Dobius+.app`
   to test — reinstalling drops Carson's live sessions.
5. **Remember-last-choice surprise**: `lastKeepOnTop` makes every later
   tear-off start pinned. Deliberate; call it out in the recap so it is
   not mistaken for a bug.
6. **Dirty `feat/buzz-skin` tree**: our file (`tear-off-window.ts`) is
   untouched by the in-flight Buzz work — commit ONLY our files; never
   `git add -A`.

## Estimate

~40 lines + ~40 lines of test. Single file + one test file.

## Done bar

Feature branch (`feat/buzz-skin` is current — confirm with Carson whether
this rides that branch or gets its own `feat/float-on-top`), typecheck 0,
unit test green, manual dev verification, commit referencing this task,
BUILD-LOG.md entry.
