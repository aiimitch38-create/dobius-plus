# Codex brief: review the Vertex Kanban and wire it to the real backend

You are reviewing and finishing the Vertex Kanban board in an Electron 42 + React 19
+ TypeScript + Tailwind 4 desktop app. Repo root:

    /Users/bayou/Projects (Code)/Dobius/dobius-plus/dobius

The board renders standalone at **http://127.0.0.1:5173/kanban.html** (dev server is
already running; `pnpm dev` if it is not). Open it and look at it before you touch code.

## Context you must not get wrong

There are **two separate task pages** and they both stay:

1. **The existing Tasks page** reads issues out of GitHub / GitLab / Linear / Jira.
   It has Issues / PRs / Projects tabs, an `is:issue is:open` query box, pagination,
   and a per-row `Start →` button. It is READ-ONLY over external systems.
   **Do not touch it. Do not merge it into the Kanban. Do not "unify" the two.**
2. **The Vertex Kanban** (what you are working on). Vertex OWNS these tasks. They are
   created here, assigned to agents here, moved here. External systems are optional
   sync targets, never the source of truth.

Also note: `src/renderer/src/components/sidebar/*kanban*` is a DIFFERENT, pre-existing
feature (the worktree kanban in the sidebar). It is unrelated. Leave it alone.

## Read these first, in this order

- `/Users/bayou/Projects (Code)/Dobius/dobius-plus/dobius/src/shared/vertex-task-types.ts`
  — the REAL backend contract (`VertexTask`, `VertexTaskSource`). Already committed.
- `/Users/bayou/Projects (Code)/Dobius/dobius-plus/dobius/src/main/vertex/vertex-task-store.ts`
  — the real store: JSON in userData, atomic write, sparse fractional ordering.
- `/Users/bayou/Projects (Code)/Dobius/dobius-plus/dobius/src/main/ipc/vertex-tasks.ts`
  — five live IPC channels: `vertexTasks:list|create|update|move|remove`.
- `/Users/bayou/Projects (Code)/Dobius/dobius-plus/dobius/src/preload/index.ts`
  — the `vertexTasks` API already exposed to the renderer. Use it; do not add channels.
- Then the UI: `src/renderer/src/components/kanban/` (KanbanBoard.tsx, KanbanColumn.tsx,
  KanbanCard.tsx, KanbanDetailPanel.tsx, kanban-types.ts, kanban-mock-source.ts,
  kanban-chips.tsx, AvatarStack.tsx) and `src/renderer/src/kanban-preview.tsx`.

## The four things that are actually wrong

Confirm each against the code before fixing. If you disagree with one, say so and
explain rather than silently skipping it.

**1. The source contract is synchronous, but the real one is async. This is the blocker.**
`kanban-types.ts` declares `TaskSource.list(): Task[]` and `KanbanBoard.tsx:~line 96`
calls `const tasks = source.list()` straight through in render. The real backend is IPC,
so every call returns a Promise. The comment claiming "a real store replaces it later with
zero component changes" is false. Make `TaskSource` async and adapt the board: load once
on mount, keep tasks in state, and apply mutations optimistically (update local state
immediately, then reconcile with what the IPC call returns, and roll back if it returns
null). Drag-and-drop must not wait on a round trip before the card moves.

**2. Column counts are hardcoded and visibly wrong right now.** `KanbanColumn.tsx` has a
`statusMeta` object with literal counts
`{backlog: 12, todo: 8, 'in-progress': 6, review: 4, testing: 3, done: 28}` that never change.
Confirmed on screen at 1600px: Backlog reads **12** with 4 cards, To Do reads **8** with 4,
In Progress reads **6** with 4, Review reads **4** with 3, Done reads **28** with 4. Only
Testing (3) is right, by coincidence. Render `tasks.length`.

**3. The UI type and the backend type have drifted.** Reconcile them, preferring the
shared type. Specifically:
   - Delete the local `Task`/`Person` types and import `VertexTask`/`VertexAssignee` from
     `src/shared/vertex-task-types.ts`. One type, one place.
   - `attachmentCount` does not exist on `VertexTask`. Derive it from `files.length`.
   - `VertexAssignee` carries `kind: 'agent' | 'human'`. That distinction is the whole
     point of this board (tasks get assigned to agents), so surface it in the UI:
     an agent assignee must be visually distinguishable from a human one on both the
     card and the detail panel.
   - `VertexTask` also has `order`, `createdAt`, `updatedAt`, `missionId`, `projectId`.
     `order` is owned by the store; never set it from the UI, only via `move()`.
   - `TaskSource` is missing `remove()`. The backend has it. Add delete to the UI.
   - `create()` takes `VertexTaskInput` (title required, everything else optional), not
     `Pick<Task,'title'|'status'>`. Note the board currently creates then immediately
     calls `update()` to set type and priority; pass them in the create call instead.

**4. Three header controls are dead stubs.** The Project dropdown has one hardcoded item
("Vertex") and no handler; "Group by: Status" has one item and no handler; the "Filter"
button is labeled generically but only toggles a high-priority filter. Either make them
work or remove them. A control that looks clickable and does nothing is worse than no
control. Your call which way, but say which you chose and why.

## Also review, and report on (do not necessarily fix)

- **Drag-and-drop index correctness.** Same-column downward drags are the classic
  off-by-one: the item is removed before the insertion index is computed. Test dragging
  a card down within one column, up within one column, into an empty column, and to the
  very top and very bottom of a full one. Report what actually happens for each.
- **The five secondary views** (List, Timeline, Calendar, Analytics, Activity) in
  `KanbanBoard.tsx` are largely faked: Timeline positions bars with `(index % 5) * 12%`,
  Calendar buckets tasks with `taskIndex % 30 === index`, Activity picks its verb with
  `index % 3`, and Analytics hardcodes team-workload percentages `72 - index * 11`.
  Say plainly which are demo-only. Do not build them out in this pass.
- **Accessibility and keyboard.** Drag-and-drop is currently mouse-only. Report what a
  keyboard-only user cannot do. Check focus rings, and whether the board is usable at
  1280px wide.
- **Dark mode does not exist — confirmed, not suspected.** Captured the board twice via
  Playwright, once with `colorScheme: 'dark'` and once with `'light'`. The two PNGs are
  pixel-identical: a white page with light columns. `prefers-color-scheme: dark` changes
  nothing, so the `kanban-*` tokens are defined for one theme only. Note the design reference
  at `src/renderer/src/assets/kanban/vertex-kanban-reference.jpg` is a DARK board, so this is
  a straight miss against the intended design, not a preference. Fix per the repo's existing
  theming approach; do not invent a third mechanism.

## Confirmed on screen (I captured it; you do not need to re-derive these)

Captured at 1600x1000, deviceScaleFactor 2, against the running dev server.

- **The sixth column is clipped.** "Done" is cut off at the right viewport edge mid-card. The
  board is `overflow-x: auto` on a `min-w-max` flex row, so it scrolls, but six columns at
  274px plus gaps do not fit 1600px and the last one has no breathing room. Decide whether
  columns should flex, narrow, or the board should indicate more content to the right.
- **The Activity tab has a stray plus icon.** `KanbanBoard.tsx` renders
  `{id === 'activity' ? <Plus className="size-3" /> : null}` inside the nav button, so the tab
  reads "+ Activity" while the other five read normally. Looks like leftover scaffolding.
- **The avatar stack overlaps too far.** In `AvatarStack.tsx` the second avatar covers the
  first enough that "MC" reads as "MO" at normal zoom. Reduce the overlap or add a ring.
- **One 404 on page load.** A resource fails to fetch. Find it and either fix the path or
  remove the reference.

## Constraints

- **Do not touch** `src/main/**`, `src/preload/**`, or `src/shared/vertex-task-types.ts`.
  The backend is committed and another agent owns it. If you need a backend change,
  write it in your report instead of making it.
- Do not touch the existing GitHub-issues Tasks page or the sidebar worktree kanban.
- Reuse what is already in this repo: `@/components/ui/*` (shadcn), `lucide-react`,
  Tailwind tokens. Do not add a dependency, and specifically do not add a drag-and-drop
  library; the native HTML5 drag already in place is fine.
- No hardcoded hex colors. CSS variables only.
- Keep `kanban-mock-source.ts` working as a fallback so `kanban.html` still renders
  standalone in a browser with no Electron IPC available. The board should take its
  source via prop, defaulting to the real IPC-backed source inside the app and the mock
  outside it.
- `pnpm run build:desktop` must exit 0 when you are done. Capture the real exit code;
  do not chain it after an `echo`.
- Leave one runnable test behind for the ordering logic if you change it.

## Return

Report as data, not prose. Give me:
1. A findings table: `file:line`, what is wrong, severity (blocker / bug / polish),
   and whether you fixed it or left it.
2. The exact list of files you changed.
3. Anything you disagree with in the four items above, with your reasoning.
4. The build exit code, verbatim.
5. Anything a reviewer must verify by hand, especially drag-and-drop behavior.

If a file named above does not exist, or the dev server is not reachable, say so and
stop rather than guessing at what the code probably looks like.
