# TASK-BUZZ-1 — Port Block Buzz's look into Dobius+ as a "Buzz" app skin

## What
Reverse-engineer the visual design of Block's Buzz (github.com/block/buzz, Apache 2.0)
and add it to Dobius+ as a selectable App Skin named "Buzz".

The look (traced from `buzz/desktop/src/shared/styles/globals/theme.css` +
`tailwind.config.js` + README screenshots):
- Full-canvas vertical gradient: light `#e6e6b6 → #c4d0da`, dark `#4a4616 → #0a1423`
- Sidebar + titlebar chrome transparent so the gradient shows through
- Translucent neutral fills: hover 4% black/white, active pill 7% (light) / 16% (dark)
- Muted sidebar labels at 40% opacity foreground
- Main content floats as a rounded card (radius 0.625rem — same as ours) with a
  hairline edge + soft shadow: `-1px -1px 0 hsl(border/0.45), 0 0 4px rgb(0 0 0/7%)`
- Inter font — SKIPPED (Geist is visually equivalent; no new dependency)

## How (files)
1. NEW `dobius/src/renderer/src/assets/buzz-skin.css` — all Buzz styling scoped
   under `:root[data-buzz-skin]` (light) and `:root[data-buzz-skin].dark`.
   Token overrides: `--worktree-sidebar`, `--bg-titlebar`, sidebar accents/borders.
   Gradient painted on `body`. Content card via `[data-buzz-content-surface]`.
2. `main.css` — import the new file.
3. `lib/app-skin.ts` — export `APP_SKIN_BUZZ = 'Buzz'`; `applyAppSkin` toggles
   `data-buzz-skin` on the root; Buzz does NOT touch dark/light classes
   (both variants exist, stylesheet theme owns the class).
4. `settings/AppearanceInterfaceSection.tsx` — "Buzz" item in the App Skin picker;
   skip the terminal-theme sync for Buzz (no matching terminal palette).
5. `App.tsx` — `data-buzz-content-surface` on the center content column.

## Test
- `pnpm typecheck` exits 0; `pnpm dev` renders: gradient canvas, transparent
  sidebar, floating content card in both light and dark. Screenshot for proof.
- Skin off (`None`) → app renders exactly as before (all rules scoped to the
  data attribute).

## Risks
- `--worktree-sidebar: transparent` also feeds hover/accent chips inside the
  sidebar → verify visually, patch specific offenders only.
- Gradient behind terminal panes: terminals keep their own opaque theme bg (fine).

## Estimate
~150 lines CSS + ~20 lines TS. One session.
