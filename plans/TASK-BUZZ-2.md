# TASK-BUZZ-2 — Buzz gets its own tab in Dobius+ that opens the Buzz UI

## What
Carson clarified mid-build: the Buzz look must live in its OWN tab in Dobius+,
opening the Buzz UI — not only as an app-wide skin. Skin from TASK-BUZZ-1 stays
(it's opt-in and complementary); this task adds the tab.

## How (files)
1. `store/slices/ui.ts` + `hooks/resolve-zoom-target.ts` — add `'buzz'` to the
   activeView unions (10 mechanical insertions after `| 'manager'`).
2. `components/buzz/BuzzPage.tsx` (NEW) — faithful recreation of the Buzz
   workspace UI: gradient canvas, transparent channel sidebar (search pill,
   Inbox/Agents nav, channel sections, DMs, profile footer), floating white
   content card (#flight-path header, message thread, NEW divider, reactions,
   agent chips, composer, agent status line).
3. `components/buzz/buzz-demo-data.ts` (NEW) — demo channels/DMs/messages
   mirroring the Buzz README screenshot.
4. `assets/buzz-skin.css` — `.buzz-page` scope carries its own palette +
   gradient so the tab renders the Buzz look regardless of active app skin.
5. `SidebarNav.tsx` — "Buzz" nav button (Hexagon icon) → setActiveView('buzz').
6. `App.tsx` — lazy-mount BuzzPage when activeView === 'buzz'.

## Test
- typecheck 0, oxlint 0, app-skin tests 6/6 green.
- Pre-existing hook-test failures (16) confirmed identical on clean tree.
- Visual: dev app screenshots of tab + skin, light + dark.

## Notes / deferred
- Demo content is static; wiring to a real Nostr relay (Buzz backend) is a
  separate decision — Buzz's relay is a Rust monorepo, embedding it is heavy.
- Inter font skipped (Geist is visually equivalent).
