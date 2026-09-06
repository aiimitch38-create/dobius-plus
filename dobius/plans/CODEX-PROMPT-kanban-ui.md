# Codex prompt — Vertex Kanban Board UI

Copy everything between the rules below into Codex.

---

You are building the **Kanban Board** screen for Vertex, the operating-system layer that sits on top of Dobius. This is a UI-only task: build the complete screen against mock data, wired so a real data source can be dropped in later without touching a single component.

## The repository

Work in `/Users/bayou/Projects (Code)/Dobius/dobius-plus/dobius` — this is the live application. Do **not** touch the legacy app at the repository root.

Stack, already installed. Add no new dependencies:

- Electron 42, React 19, TypeScript
- Tailwind CSS 4
- Zustand for state
- electron-vite, pnpm

## Read these before writing anything

- `src/renderer/src/components/ui/` — the existing shadcn-style primitives. **Use them; do not rebuild them.** Available: `badge.tsx`, `button.tsx`, `card.tsx`, `checkbox.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `popover.tsx`, `scroll-area.tsx`, `select.tsx`, `accordion.tsx`, `collapsible.tsx`, `context-menu.tsx`, `hover-card.tsx`, `input.tsx`, `label.tsx`, `progress.tsx`, `command.tsx`, `tooltip`, `tabs`.
- `src/renderer/src/assets/main.css` — the theme tokens. Every colour you use must come from here.
- Any existing panel/tab component in `src/renderer/src/components/` — match its file layout, naming, and prop conventions.

## Hard rules

1. **No hardcoded hex colours anywhere in a component.** CSS variables only. If a colour you need does not exist as a token, add the token to `main.css` and reference it. This is a standing project rule, not a preference.
2. **No new dependencies.** Drag-and-drop must be built with native HTML5 drag events or pointer events. Do not install dnd-kit, react-beautiful-dnd, or anything else.
3. **The Kanban never calls an external service directly.** It renders Vertex tasks and nothing else. It must not import an Asana client, a GitHub client, or any API module. All data arrives through one adapter interface (below). This is the whole point of the architecture — Kanban is a *view*, not a system.
4. **Do not invent a backend.** No IPC handlers, no database, no main-process code.
5. **Keyboard and focus states are required**, not optional. Every interactive element gets a visible `:focus-visible` state.
6. Match the existing code's comment density and naming. Comment only where the *why* is non-obvious.

## Data contract — build this first

Define these types in `src/renderer/src/components/kanban/kanban-types.ts`, then build every component against them:

```ts
export type TaskStatus = 'backlog' | 'todo' | 'in-progress' | 'review' | 'testing' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskType = 'feature' | 'design' | 'integration' | 'ai' | 'security' | 'infra' | 'bug'

export type Person = { id: string; name: string; avatarUrl?: string; initials: string }

export type Task = {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  type: TaskType
  coverImageUrl?: string          // some cards show a thumbnail, most do not
  commentCount: number
  attachmentCount: number
  assignee?: Person
  collaborators: Person[]
  dueDate?: string                // ISO date
  labels: string[]
  related: { id: string; label: string }[]
  dependencies: string[]          // task ids
  subtasks: { id: string; title: string; done: boolean }[]
  files: { id: string; name: string; url?: string }[]
}

/** The ONLY way the board reads or writes tasks. Ship an in-memory mock
 *  implementation now; a real store replaces it later with zero component
 *  changes. */
export type TaskSource = {
  list(): Task[]
  move(taskId: string, to: TaskStatus, toIndex: number): void
  update(taskId: string, patch: Partial<Task>): void
  create(partial: Pick<Task, 'title' | 'status'>): Task
}
```

Ship `kanban-mock-source.ts` implementing `TaskSource` over a Zustand store, seeded with the sample data listed at the bottom of this prompt.

## Screen layout

Dark theme. Three regions: a header, a horizontally scrolling column area, and a fixed bottom dock. A detail panel slides in from the right.

### 1. Header

- Title **"Kanban Board"**, large and bold.
- Subtitle beneath it: **"Visualize work. Assign agents. Ship faster."**
- Right-aligned control row:
  - `Project` label followed by a dropdown showing a small coloured project glyph and the text **"Vertex"** with a chevron.
  - **Filter** button, funnel icon.
  - **Search** button, magnifier icon.
  - **Group by: Status** dropdown with chevron.
  - **+ New Task** — primary accent button with an attached split-dropdown chevron on its right edge.

### 2. View tabs

A row directly under the header: **Board** (active), **List**, **Timeline**, **Calendar**, **Analytics**, **+ Activity**. Each has a leading icon. The active tab is marked with an accent underline and brighter text. Only Board renders content; the others render a simple empty state.

### 3. Columns

Six columns, horizontally scrollable, each a fixed width (~300px) and independently vertically scrollable.

Each column header shows: a status glyph in that status's colour, the column name, a count badge, and a `+` button on the right.

| Column | Count | Glyph colour |
|---|---|---|
| Backlog | 12 | neutral grey |
| To Do | 8 | blue |
| In Progress | 6 | violet |
| Review | 4 | amber |
| Testing | 3 | red |
| Done | 28 | green |

Each column ends with a muted **"+ Add task"** row.

### 4. Task cards

Vertical stack inside each column. A card contains, in order:

1. **Title**, semibold.
2. **Chip row** — a type chip and a priority chip, small, rounded-full, tinted background with matching text colour. Type and priority each map to their own colour token.
3. **Optional cover image**, 16:9, rounded, only when `coverImageUrl` is set.
4. **Description**, two lines maximum, clamped with ellipsis, muted colour.
5. **Footer row** — a comment icon with count, an attachment icon with count, and a right-aligned overlapping avatar stack (each avatar has a ring in the card background colour so overlaps read cleanly).

Cards are draggable between and within columns. While dragging show a placeholder gap at the drop position and reduce the dragged card's opacity. Clicking a card opens the detail panel.

### 5. Detail panel

Slides in from the right, roughly 420px wide, over the board, with the board still visible to its left.

- **Header row**: square app glyph, the task title, a link icon, an open-in-new icon, and a close X.
- **Three dropdowns side by side**: `Status`, `Priority`, `Type` — each showing its current value with the matching status/priority/type colour.
- **Tab row**: `Details` (active), `Subtasks`, `Files` with a count badge, `Canvas`, `Activity`.
- **Description paragraph** in full, unclamped.
- **Image gallery**: a row of thumbnails plus a dashed **"+ Add"** tile.
- **Field list**, label on the left in muted text, control on the right:
  - **Assignee** — avatar plus name in a dropdown.
  - **Collaborators** — overlapping avatar stack plus a `+` button.
  - **Due date** — calendar icon plus formatted date in a dropdown.
  - **Labels** — coloured chips plus a `+` button.
  - **Related** — chips with a small glyph, plus a dropdown.
  - **Dependencies** — a chip reading "N tasks" plus a `+` button.
- **Description editor** with a `Write` / `Preview` segmented toggle, a formatting toolbar (bold, italic, strikethrough, link, bulleted list, numbered list, quote, code, image, table), and rendered bullet content below.
- **Footer, pinned to the bottom of the panel**: a secondary **"Create Subtask"** button and a primary accent **"Assign to Agent"** button with a split-dropdown chevron.

### 6. Bottom dock

Fixed to the viewport bottom, centred, floating above the board:

- Left: a compact audio/waveform widget with a collapse control.
- Centre: **+ New Task**, **Capture Screen**, **Add to Canvas**, **Ask AI**, **Create Note** — each an icon plus label.
- Right: a green status dot with **"All Systems Operational"**, and a clock icon with the current time.

## Visual direction

- Near-black page background; columns sit on a slightly lighter surface; cards lighter again with a subtle 1px border.
- Accent is violet — used for the primary buttons, the active tab underline, and the app glyph. Nothing else competes with it.
- Corner radius ~10px on cards and panels, fully rounded on chips and avatars.
- Chips are low-opacity tinted backgrounds with a saturated text colour of the same hue.
- Generous vertical rhythm inside cards; tight, aligned metadata in footers.
- Use `font-variant-numeric: tabular-nums` for all counts.

## Files to create

```
src/renderer/src/components/kanban/
  kanban-types.ts
  kanban-mock-source.ts
  KanbanBoard.tsx          // page shell: header, tabs, dock
  KanbanColumn.tsx
  KanbanCard.tsx
  KanbanDetailPanel.tsx
  kanban-chips.tsx         // type/priority/label chip components
  AvatarStack.tsx
```

## Acceptance criteria

Done means all of these are true:

1. The board renders all six columns with the seed data, matching the layout described above.
2. A card can be dragged to another column and to a new position within a column; the change persists in the Zustand store and the column counts update.
3. Clicking a card opens the detail panel populated from that task; the close X dismisses it.
4. Changing Status, Priority, or Type in the panel updates the card on the board immediately.
5. Every colour resolves from a CSS variable. `grep -rE "#[0-9a-fA-F]{3,8}" src/renderer/src/components/kanban/` returns nothing.
6. No new entries in `package.json`.
7. Keyboard: Tab reaches every control, focus is visibly ringed, Escape closes the panel.
8. `pnpm exec tsgo --noEmit -p config/tsconfig.tc.web.json` exits 0.
   **Do not run bare `tsgo`** — it fails in this repo with a `baseUrl` error. Always pass `-p` with that exact config path.
9. `pnpm run build:desktop` exits 0. Verify the real exit code; do not chain it after an `echo`.

## Guardrails — what NOT to do

- Do not modify anything under `src/main/` or `src/shared/`.
- Do not add IPC, database, or network code.
- Do not restyle or "improve" the existing `ui/` primitives.
- Do not add a routing library; the view tabs are local state.
- Do not use placeholder text anywhere — use the real seed content below.
- Work on a feature branch, never on `main`. Commit in working increments.

## Seed data — use exactly this content

**Backlog (12 total, render these 4)**
- *Canvas 2.0 – Image Annotation* · Feature · High · cover image · "Add native image annotation tools with arrows, callouts, and notes." · 12 comments · 4 files · 2 people
- *Mobile App – iOS* · Feature · Medium · "Initial mobile layout and navigation system." · 8 · 2 · 2
- *AI Voice Commands* · Integration · High · "Global voice controls for all pages." · 15 · 6 · 2
- *Knowledge Graph View* · Feature · Medium · "Visualize relationships between notes, tasks, and projects." · 10 · 3 · 2

**To Do (8 total, render these 4)**
- *Command Center – Redesign* · Design · High · cover image · "New layout with spatial UI and live system status." · 8 · 4 · 2
- *Agent Management UI* · Feature · High · "Full agent control panel with status, logs, and memory." · 12 · 5 · 2
- *Canvas – Slideshow Mode* · Feature · Medium · "Convert frames to presentation mode." · 6 · 2 · 2
- *Integrations – GitHub* · Integration · High · "Repo sync, PR view, commit history." · 8 · 3 · 2

**In Progress (6 total, render these 4)**
- *Kanban – Full Functionality* · Feature · High · cover image · "Drag & drop, assignees, dependencies, everything." · 14 · 5 · 2
- *Canvas – Live Browser* · Feature · High · "Embed live browser with DOM selection." · 10 · 4 · 2
- *Visual QA Agent* · AI · High · "Compare screenshots and detect UI changes." · 16 · 3 · 2
- *Database Optimization* · Infra · Medium · "Improve indexing and performance." · 8 · 2 · 2

**Review (4 total, render these 3)**
- *UI Component Library* · Design · Medium · cover image · "Finalize component library and variants." · 6 · 3 · 2
- *Agent Permissions* · Security · High · "Role-based access and approval system." · 8 · 4 · 2
- *Canvas – File Support* · Feature · Medium · "Support PDFs, videos, and code files." · 6 · 3 · 2

**Testing (3)**
- *Real-time Collaboration* · Feature · High · "Multiple cursors, live presence." · 10 · 4 · 3
- *Task → Agent Pipeline* · AI · High · "Send annotated tasks directly to agents." · 12 · 5 · 2
- *Notification System* · Feature · Medium · "In-app, email, and mobile alerts." · 8 · 2 · 2

**Done (28 total, render these 4, each with a green check)**
- *Authentication* · *Project Framework* · *Basic Kanban* · *File Management*

**Detail panel opens on "Canvas 2.0 – Image Annotation"** with:
- Status Backlog · Priority High · Type Feature
- Description: "Add native image annotation tools with arrows, highlights, text, shapes, and voice notes. Must support screenshots, images, and live previews."
- Assignee: Vision (Design) · Due date: Sep 12, 2026
- Labels: Canvas, UI/UX, High Priority
- Related: Canvas 2.0, VERTEX · Dependencies: 2 tasks · Files: 3
- Editor body:
  > This feature should allow:
  > - Arrow, text, shapes, highlights
  > - Voice annotations (STT)
  > - Attach notes and files
  > - Convert annotations to tasks
  > - AI analysis of screenshots
  > - Work on images and live previews
  > - Integrate with agents and tasks

## Report back

When finished, return: the files you created, any token you added to `main.css` and why, the exit codes of the typecheck and build, and anything a reviewer must check by eye. If a requirement is ambiguous, implement the most conservative reading and say which one you chose — do not guess silently.
