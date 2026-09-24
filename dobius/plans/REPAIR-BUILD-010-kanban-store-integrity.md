# REPAIR BUILD-010 — Kanban store integrity (#28 #47)

## Root cause
- #28: `vertex-task-store.ts` `readAll()` treated every read failure the same as "no file":
  `JSON.parse` / `readFileSync` errors were caught and cached as `[]`, and a non-array top level
  also became `[]`. The next `create/update/move/remove` then `persist()`ed that empty (or
  one-card) array over the real board with temp+rename, wiping every card.
- #47: `remove()` only filtered the deleted row out. A parent kept the deleted child's id in
  `childTaskIds`; deleting a parent left children pointing at it through `parentTaskId`;
  dependents kept the id in `dependencies`.

## Fix
- `src/main/vertex/vertex-task-store.ts`
  - Persistence moved onto BUILD-009 `SafeJsonFile<VertexTask[]>` (same path
    `userData/vertex-tasks.json`, same format plus a trailing newline). Parse = old row filter +
    normalization; non-array → unreadable. Missing file → `[]`, nothing written on load.
  - `readAll()` throws `The Kanban board file <path> could not be read (<errno|invalid JSON|
    unexpected JSON shape>). The board is read-only until the file is fixed or removed.` whenever
    SafeJsonFile reports `unreadable`. So `list`, `reload`, `create`, `update`, `move`, `remove`
    all refuse; no mutation runs, SafeJsonFile quarantines a copy, the original bytes never change.
    SafeJsonFile re-reads on every access, so a repaired file recovers without a restart.
  - Why read-only instead of SafeJsonFile's session-only mode: an empty board that silently
    accepts edits that are never saved is the same trap users fell into; the Kanban has no
    background writer that must keep going.
  - `persist()` throws when `SafeJsonFile.set()` returns false (write error), and replaces the
    SafeJsonFile instance first. Why: `set()` keeps the unsaved value in its cache and the store
    mutates cached rows in place, so the board would otherwise show edits that never reached disk.
    The old code threw too (writeFileSync), so callers already handle a throw.
  - `remove()` (#47): in the same persisted array, strips the id from every `childTaskIds` and
    `dependencies`, and clears `parentTaskId` on its children (children are kept, not deleted);
    touched rows get `updatedAt`.
- `src/renderer/src/components/kanban/KanbanBoard.tsx` (outside the spec's file list; see
  Deviations): the 4 s poll now catches a failed `list()` and shows one sticky error toast
  (`id: kanban-load-error`, message via existing `extractIpcErrorMessage`), dismissed on the next
  successful load. This is the "visible error"; before, the rejection was unhandled and the board
  just looked empty.

## Callers checked
- `ipc/vertex-tasks.ts`: `create` already catches → null; `list/reload/update/move/remove`
  rejections reach the renderer. KanbanBoard reverts optimistic update/move/delete on rejection.
- `agents/agent-tools/dobius-tool-handlers.ts` `create_board_task`: `create` could already throw
  on a failed write; `dobius-tool-server.ts` has no catch around `createBoardTask`, so the throw
  goes to the MCP SDK tool wrapper (not verified here how the SDK reports it to the agent).
- Renderer `board-dispatch.ts`: `poll()` wraps `list()` in try/catch → no dispatch while
  unreadable (fail closed, no paid run). `AgentsOverview` already `.catch(() => [])`.

## Tests (`src/main/vertex/vertex-task-store.test.ts`)
- Replaced `starts empty rather than throwing on a corrupt file` (it encoded the bug) with
  `recovers without a restart once an unreadable file is repaired`.
- `unreadable board file` (table: malformed JSON, non-array top level, EACCES chmod 000): every
  API throws `read-only`; file text identical afterwards; no `.tmp` left.
- `throws and keeps showing the disk state when a save fails` (dir chmod 500).
- `remove relationships`: delete child → parent `childTaskIds` = [sibling] on disk; delete parent
  → child kept with no `parentTaskId`, dependent's `dependencies` loses only the parent id,
  nothing else deleted.
- Root-only skips for the chmod cases (root ignores file modes).

## Mutation checks (each run of the file; restored after)
- M0 original store from HEAD: 7 fail (all new tests).
- M2 `readAll` ignores unreadable status: 4 fail.
- M3 `remove` skips unlinking: 2 fail.
- M4 `persist` keeps the SafeJsonFile cache on a failed save: 1 fails.
- Restored: 32/32 pass.

## Deviations from EXECUTION-ORDER.md
- Edited `KanbanBoard.tsx` (17 lines) for the visible error; the store alone can only throw.
  Not covered by a unit test (no KanbanBoard component test harness exists).
- #47 also clears `parentTaskId` on children and dangling `dependencies` ids (BUG-MATRIX asks for
  "delete child and parent cases; no surviving dangling references"). `dependencies` gate
  nothing today (grep: only KanbanDetailPanel display/edit), so no dispatch behavior changes.
- Not fixed (out of scope, noted for review): `update()` re-parenting leaves the old parent's
  `childTaskIds` entry.

## Rollback
Revert the commit. Quarantine copies `vertex-tasks.json.unreadable-<ms>` stay on disk.

## Verification
- `pnpm run typecheck` exit 0.
- `vertex-task-store.test.ts`: 32/32 pass.
- oxlint + react-doctor: clean on `vertex-task-store.ts` and its test. Fixed pre-existing mechanical
  `curly` / `unicorn(prefer-at)` errors in all three touched files (brace-only diff hunks).
  `KanbanBoard.tsx` keeps pre-existing `max-lines` (1005 lines before, limit 400); fixing it needs
  a file split, out of scope.
- Full suite: DEFERRED to the coordinator.

## Lessons
- Typecheck and oxlint take several minutes under the parallel-build load; run them in the
  background instead of against the 2-minute tool timeout.
