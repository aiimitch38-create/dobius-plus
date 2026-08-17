# TASK: Universal dictation — orb + voice-to-text in any macOS app

Branch: `feat/voice-orb-dictation` (continues from `fc63267`, `4d07285`)

## Goal

Press ⌘E anywhere on the Mac → the orb appears floating over whatever app you're
in → speak → press ⌘E again → the transcript is inserted into that app.

**One behavior everywhere.** Carson's call: it must not matter whether the front
app is Dobius+, Chrome, or anything else — same ⌘E, same floating orb, same
insertion. That means a single code path, not an in-app path plus a global one.
Dobius+ must be running (it owns the hotkey and the speech model).

Consequences, accepted deliberately:
- ⌘E is claimed system-wide, permanently while Dobius+ runs. It overrides Finder's
  Eject and "Use Selection for Find" in text apps.
- Dictation becomes **tap-to-toggle everywhere**, including inside Dobius+.
  Hold-to-talk cannot survive a global hotkey (`globalShortcut` never sees key-up),
  so the existing `dictationMode: 'hold'` setting stops applying. Restoring hold
  later means building the CGEventTap that Phase-0 cut.
- The floating overlay replaces the in-app indicator as the single dictation UI.

## The algorithm pass — what got cut

Applied before writing any task. Each cut names what breaks without it.

| Requirement | Verdict | Why |
|---|---|---|
| Hold-to-talk works system-wide | **CUT from v1** | Needs a CGEventTap in Swift + a second TCC permission (Input Monitoring). Electron's `globalShortcut` has no key-release event. Toggle mode needs neither and reaches the same outcome. Biggest single cut. |
| Live partial transcript typed into the foreign app | **CUT** | Would require deleting/replacing text already inserted in an app we don't control. Insert once, at the end. Partials still show in the orb caption. |
| `electron-panel-window` dependency | **CUT unless proven necessary** | Try `focusable: false` + `screen-saver` level first (Phase 0a). Only add a native dep if the built-ins fail. |
| New permissions UI | **CUT** | The helper already returns `accessibility_error` with a fix-it message (`macos-computer-use-permissions.ts:174`). Surface it as a toast. |
| Settings pane for the feature | **DEFER** | Ships under existing voice settings. Add a toggle only if v1 proves annoying. |
| Fix ad-hoc-signing TCC resets | **DEFER, not ignored** | Real problem (see Risks) but orthogonal. Re-granting during dev is survivable. |

Nothing is built until Phase 0 proves the two unknowns.

## What already exists (verified, do not rebuild)

- `computer.pasteText` RPC — callable from main today (`runtime/rpc/methods/computer-actions.ts`)
- Clipboard save → paste → restore, already correct (`native/computer-use-macos/.../main.swift:2359-2374`)
- Floating transparent always-on-top window pattern (`main/window/floating-phone-window.ts:124-140`)
- Orb + mic level + STT — done, shipping (`components/dictation/`)

## Phase 0 — de-risk (do FIRST, throwaway code)

Two unknowns can invalidate the design. Prove both before building anything.

- **0a** Spike an overlay `BrowserWindow` with `focusable: false`,
  `setAlwaysOnTop(true, 'screen-saver')`, `setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true})`.
  **DONE =** overlay is visible above TextEdit, and typing in TextEdit still goes to TextEdit.
  **If it fails →** add `electron-panel-window`, re-test, then continue.
- **0b** With Dobius+ unfocused and TextEdit frontmost, call `computer.pasteText`.
  **DONE =** text lands in TextEdit and the clipboard is unchanged afterward.
  **If it fails →** stop and re-plan; the whole feature rests on this.
- **0c** Same call, but with a Dobius+ terminal pane frontmost.
  **DONE =** text lands in the xterm pane.
  **Why this spike exists:** "one path everywhere" means Dobius+ receives synthetic
  paste like any other app, replacing the precise in-pane insertion that
  `dictation-insertion-target.ts` does today. If xterm mishandles it, that is the
  one case where the single path has to fork — better to learn it in a spike than
  after Phase 3.

## Phase 1 — global hotkey

Register an OS-level shortcut so the hotkey fires when Dobius+ is unfocused.

- New `src/main/dictation/global-dictation-shortcut.ts` using Electron `globalShortcut`
- Key is `CommandOrControl+E`, registered once at startup and held for the app's lifetime
- The in-app `voice.dictation` binding (`shared/keybindings.ts:326`) becomes dead —
  the global registration swallows ⌘E before any window sees it. Remove it rather
  than leaving a shortcut row in Settings that silently does nothing.
- Handle `register()` returning false (another app already owns ⌘E) → surface a toast
- Unregister on quit so ⌘E returns to Finder and everything else
- **DONE =** pressing ⌘E from inside Safari toggles a logged state in the main process

## Phase 2 — overlay window

- New `src/main/window/dictation-overlay-window.ts`, modeled on `floating-phone-window.ts`
- Loads a minimal renderer route rendering `<VoiceOrb>` + caption — reuse, don't fork
- Positioned bottom-center of the active display; click-through (`setIgnoreMouseEvents(true)`)
- Show on dictation start, hide on finish
- **DONE =** hotkey from Safari shows the orb over Safari, Safari keeps focus

## Phase 3 — route audio + transcript

- Mic capture must run in the overlay renderer (or an existing hidden window) so it
  works with no project window open
- On final transcript: always `computer.pasteText` into the frontmost app. No branch —
  that is the point of the single-path decision. `dictation-insertion-target.ts` is
  retired unless spike 0c says xterm needs it.
- Empty transcript → no paste, no clipboard touch
- **DONE =** speak into Safari's address bar, words appear there; same in a Dobius+ terminal

## Phase 4 — failure handling

- Accessibility not granted → toast with the helper's own fix-it message
- Helper unavailable → toast, orb hides, no silent failure
- **DONE =** revoking Accessibility produces a clear message, not a dead orb

## Verification per phase

`pnpm run typecheck:web` + `npx oxlint <changed dirs>` green, unit test for any
non-trivial pure logic, and a manual check against a real third-party app.
Full `pnpm run build` is currently blocked by an unrelated file — see Risks.

## Risks

1. **Ad-hoc signing resets TCC grants on every install.** Accessibility is
   load-bearing here. Expect to re-grant after each rebuild during development.
   A real fix is a stable signing identity — out of scope, worth scheduling.
2. **`pnpm run build` is red** on `src/main/communications/agent-participant-identity-store.test.ts:36`
   (unused `store`), unrelated in-flight work. Building around it, not touching it.
3. **Hotkey collisions** — `globalShortcut.register` returns false if taken; surface it.
4. **Hold mode**: Carson's config is `dictationMode: 'hold'`. Global path is toggle-only
   in v1, so global and in-app behave differently. Call it out in the UI or accept it.
