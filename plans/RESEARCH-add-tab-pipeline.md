# RESEARCH — "Add Tab": drop in a GitHub repo, pipeline ports it into a Dobius+ tab

_2026-08-02 · research only, nothing built. Companion idea parked: TASK-float-on-top.md._

## The idea (Carson's words, condensed)

Press "+ Add Tab" in Dobius+, drop in a GitHub repo URL, explain what you
want and don't want from it. A backend process of scripts + agents reverse
engineers the repo and the result lands as a native Dobius+ tab.

## Verdict: feasible — and it already happened once, manually

Commit `029a996` (Buzz tab, 2026-07-30) IS this pipeline run by hand:
took `github.com/block/buzz` (Apache 2.0), traced its theme.css, recreated
the workspace UI as `components/buzz/BuzzPage.tsx`, registered it as a tab.
13 files, ~740 lines. The automation job is: productize that session.

## Measured: what "adding a tab" touches (from the Buzz commit)

Fixed wiring points (mechanical, same every time — automatable):
1. `App.tsx` — `lazy(() => import(...))` (App.tsx:285) + render branch (App.tsx:2380)
2. `components/sidebar/SidebarNav.tsx` — nav entry
3. `store/slices/ui.ts` — view id added to state
4. `hooks/resolve-zoom-target.ts` — one line
5. `assets/main.css` — css import (only if the tab ships a stylesheet)

Feature payload (the creative part — agent work, not script work):
- `components/<name>/<Name>Page.tsx` + demo/seed data + optional css

## Architecture decision: compiled tabs, not runtime plugins

Tabs are compiled React components — a new tab means rebuild + reinstall.
That is acceptable here because:
- `build-and-install.sh` exists and is routine.
- The session daemon now survives reinstall (NOTES 2026-07-12: detached
  daemon + cold-restore), so rebuilding no longer costs live sessions.
- A runtime plugin system (dynamically loaded tab bundles or webview-hosted
  tabs) is a much bigger build with security surface. YAGNI for v1; noted
  as option C below.

## The pipeline (7 stages)

1. **Intake** — repo URL + "what I want / don't want" prompt.
2. **License gate (hard gate, first)** — shallow-clone, read LICENSE:
   - MIT / Apache-2.0 / BSD → proceed; record attribution in the commit
     message (exactly like the Buzz commit did).
   - GPL / AGPL → STOP and surface: copying code in creates open-source
     obligations. Look-and-feel reimplementation from screenshots is the
     fallback lane.
   - No license → all rights reserved. Ideas/layout inspiration only, no
     code or asset copying. Surface to Carson before proceeding.
3. **Recon** — agent reads the repo source (easier than the
   `reverse-engineer-electron` skill's asar case — source is right there):
   stack detection, locate the feature Carson described, extract exact
   values (colors, gradients, spacing, layout, interaction logic).
4. **Port spec** — write `plans/TASK-<name>-1.md`: what to extract vs
   re-implement in Dobius idioms (React 19, Tailwind 4, Zustand, shadcn
   primitives, STYLEGUIDE tokens). This is what TASK-BUZZ-1/2.md were.
5. **Build** — autonomous run (crack_bot supervisor pattern) on a feature
   branch: scaffold the 5 wiring points + generate the feature payload.
6. **Verify** — typecheck 0, build 0, screenshot the new tab in the dev
   app, side-by-side with the upstream repo's README screenshot.
7. **Ship gate** — human review, then `build-and-install.sh`. Tab appears
   on next app launch.

## Build shape: v1 is a skill, not app code

The heavy lifting is stages 2–6, and none of them need app changes.

- **v1 — `/port-tab` skill** (`~/.claude/skills/port-tab/`): run in any
  Dobius+ terminal: `/port-tab <github-url> "<what you want>"`. Encodes the
  pipeline above. Zero app changes; ship this first and battle-test on the
  next repo Carson wants.
- **v2 — the "+ Add Tab" button**: small app change. Dobius+ already knows
  how to open a terminal tab pre-loaded with an agent prompt (Custom
  Agents plumbing). The button = dialog (URL + description) → spawn
  terminal tab running the /port-tab skill with those args. The "backend
  process" IS a visible agent session in a tab — fits the product.
- **v3 (only if wiring edits get flaky)** — refactor tab registration to a
  single manifest file so stage 5 edits one file instead of five. Do not
  build pre-emptively.
- **Option C (parked)** — runtime webview tabs for web-app repos: embed the
  running upstream app in the existing browser-manager webview as an
  instant "preview tab" while the port bakes. Nice-to-have, not core.

## Risks

1. **License violations shipped silently** — why the gate is stage 2 and
   hard-stops. The Buzz commit set the standard: name the repo + license
   in the commit message.
2. **Scope explosion per repo** — "I love this UI" can mean a 40-file app.
   The intake prompt must force "what you want / don't want" down to one
   screen/feature per run (Buzz = one workspace view + one skin).
3. **Wiring drift** — App.tsx is huge and changes often; the 5-point edit
   is the fragile stage. Mitigation: verify stage catches it (typecheck +
   render); v3 manifest refactor if it fails twice (LESSONS-LEARNED rule).
4. **Reinstall while sessions live** — daemon survives, but stage 7 still
   uses `pkill -x "Dobius+"` rules (NOTES 2026-07-12); never regress that.
5. **Upstream repos with no build/screenshot** — verify stage falls back
   to visual diff against README images or a locally run upstream dev
   server.

## Reusable assets already on this machine

- `reverse-engineer-electron` skill — for closed apps (no source); its
  port-spec output format is the template for stage 4.
- `crack_bot` / `crackbot-supervisor.sh` — stage 5 harness.
- `plans/TASK-BUZZ-1.md` / `TASK-BUZZ-2.md` — real examples of a port spec.
- Custom Agents temp-prompt launch — v2 button plumbing.
- `webapp-testing` / computer-use skills — stage 6 screenshots.

## Recommended next step

Build the `/port-tab` skill (v1) and run it on the next repo Carson picks.
The button (v2) is a half-day add once v1 has survived two real ports.
