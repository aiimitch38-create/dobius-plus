# REPAIR — "Dobius+ hit a renderer error" (app shell blank)

Date: 2026-08-29
Branch: feat/computer-use-v2

## Symptom
Installed /Applications/Dobius+.app (2.0.0-rc.1, packaged 16:18) boots to a blank
window with the root error boundary: "Dobius+ hit a renderer error. The app shell
could not finish rendering."

## Root cause
`dobius/electron.vite.config.ts` declared TWO preload rollup entries:
`src/preload/index.ts` and `src/preload/communications.ts`.
`index.ts` imports `communications.ts` statically, so rollup emitted
`const communications = require("./communications.js")` at the top of
`out/preload/index.js`.

The main window sets `sandbox: true` (src/main/window/createMainWindow.ts:149).
A sandboxed preload may only `require()` a small allowlist of built-ins — it
cannot require a sibling file. The preload therefore threw before exposing
`window.api`, and every renderer read of `window.api` during App's first render
threw, which the root boundary caught.

Verified in the packaged asar:
  out/preload/index.js line 3: `const communications = require("./communications.js");`

## Proof (A/B against a copy of the real userData)
- Two-entry preload config -> root text == the exact reported error, `typeof window.api === "undefined"`.
- Single-entry preload config -> app shell renders normally (sidebar, workspaces).
Both runs: `electron-vite preview` (production bundle), `--user-data-dir` pointed
at a copy of ~/Library/Application Support/dobius-plus.

## Fix
Single preload rollup entry; `communications.ts` is bundled into `index.js` as a
regular module. Nothing loads `communications.js` standalone since the vendored
Buzz webview was retired (commit fdcffaaf).

## Rollback
`git revert` the fix commit and rebuild; the app returns to the broken state.

## Follow-up (not part of this repair)
- `dobius` CLI reads runtime metadata from "Application Support/Dobius+/" while the
  app writes "Application Support/dobius-plus/" — CLI could not see the running app.
  Worked around locally with a symlink; needs a real fix.
- `pnpm run typecheck` (node project) currently fails on 5 pre-existing errors in
  src/main/communications/providers/* — unrelated to this crash, but it means
  `npm run build` (build:desktop) cannot complete until they are fixed.
