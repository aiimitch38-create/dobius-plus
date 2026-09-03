# TASK-COMMS-P5B — adopt the Buzz UI as ours, restyle with Grok Bot as reference

## What

1. **Keep the harness.** `src/main/communications/` (28,806 lines, gate 21/21) is
   untouched. Relay, Nostr, the 63 commands, the method seam — none of it moves.
2. **Close Phase 5.** Commit the eight uncommitted files in
   `src/main/communications/providers/` + `HarnessCatalogSection.tsx`; add one
   `OpenRouterProvider` behind the existing seam.
3. **Restore the Buzz UI from git history as our own source.** It lives at
   `fdcffaaf^:dobius/vendor/buzz-desktop/src` — 1,182 feature files + 331 shared.
   Bring it back to `dobius/src/renderer/src/components/communications/`, NOT to
   `vendor/`.
4. **Restyle it using the Grok Bot repo as a design reference only.** No files copied.

## Why this is legitimately ours

Buzz ships an **Apache License 2.0** (`fdcffaaf^:dobius/vendor/buzz-desktop/LICENSE`).
Apache 2.0 grants the right to use, modify, and redistribute, including in a
closed product, on two conditions we will meet: keep the license text and a NOTICE
crediting upstream, and state that we changed the files. Forking it and making it
ours is exactly what the license is for.

The Grok Bot fork has **no license** and was reconstructed from Anysphere/Cursor's
compiled binary; its own `NOTICE.md` disclaims any upstream grant. It is a reading
source for layout and interaction decisions, never a copy source.

Its feature tree already matches our backend one-for-one — agents (295 files),
messages (222), channels (127), projects (87), profile (63), sidebar (51),
settings (47), workflows (18), huddle (17). Those are the same families the gate
already proves. Rebuilding them on shadcn would be re-writing working, licensed code.

## Restore the UI, not the vendor architecture

Phase 4 deleted the right thing for the right reason. What it killed was the
**delivery model**: a sandboxed guest webview with a Tauri-shim bridge, its own
`build:buzz-ui` step, a separate trust path, and 400 MB in the tree. That stays dead.

What we take back is the **React source**. It renders in the main window, which since
Phase 4 already has the communications bridge in its preload, and calls our gateway by
method name. No webview, no Tauri shim, no separate build.

## Making it ours (the rebrand pass)

Per file, as it lands: rename Buzz symbols and routes to Dobius+ naming, replace the
Buzz theme layer with our CSS variables (house rule: no hardcoded hex in components),
drop features our backend does not serve, and apply the Grok Bot reading — sidebar
sections, message-row affordances, status and permission treatments, command palette.

## Explicitly not doing

- No transport change. Nostr + our local relay stay.
- No Grok Bot files copied — reference only. No `sand-*` primitives, no icon registry
  (we have `components/ui/*` + `lucide-react` already), no ProductionRenderer.
- No computer-shell, PDF viewer, plugin browser, org-chart, Docker sandbox.
- No Discord/Slack connectors (unbuilt upstream anyway).

## Test

- `pnpm run typecheck:node && pnpm run typecheck:web` exit 0.
- `scripts/run-comms-gate.sh` stays 21/21 — the UI move must not touch the backend.
- `npx vitest run src/renderer/src/components/communications src/main/communications/providers`.

## Risks

- **Biggest unknown: dependency re-entry.** The Buzz tree used TanStack Router
  (`routeTree.gen.ts`), `jdenticon`, `upng-js` and its own theme system. First step is
  to measure the real dependency list and line count before any file moves — that
  number decides whether this lands in one pass or feature by feature.
- Its 1,333-line native client (`components/buzz/native/`) becomes redundant; delete it
  once the restored UI covers the same surface, not before.
- Shared checkout has other agents' uncommitted work. Stage only these paths.

## Order

1. Measure: dependency list + LOC of the restored tree. Report before moving files.
2. Phase 5 close (commit what exists, then OpenRouter).
3. Restore messages + channels + sidebar first — the surface you actually look at.
4. Rebrand/restyle pass on those, Grok Bot as reference.
5. Agents, projects, profile, settings, huddle, workflows.
6. Delete `buzz/native/`, gate, build, install.
