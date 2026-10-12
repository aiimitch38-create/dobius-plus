# REPAIR BUILD-040 — Kanban UI truth (#93, #95)

## Root causes
- **#93** `renderer/.../kanban/KanbanBoard.tsx` `getCompletionProof` asked for the Done result note
  with `window.prompt(...)`. Electron's renderer does not implement `window.prompt`; it returns
  `null`. So every move to Done (drag onto the Done column → `moveTask`, or the detail panel's status
  select → `updateTask`) of a card without a stored note hit `toast.error('Done needs a result note')`
  and returned: the card snapped back and there was no way to enter the note from the move.
- **#95** Analytics view: `Math.round((done / tasks.length) * 100)` with `tasks.length === 0`
  (empty board, or a search/filter that hides every card) is `0 / 0 = NaN`, rendered "NaN%".

## Fix
- New `kanban/KanbanDoneNoteDialog.tsx`: app-owned dialog (same `Dialog` primitives and kanban
  classes as the existing "Create a task" dialog). Textarea for the note, "Mark done" disabled
  until the trimmed note is non-empty, Cancel / Esc / outside click all cancel.
- `KanbanBoard.tsx`: `getCompletionProof` removed. When a Done write needs a note, `moveTask` /
  `updateTask` park the request in `pendingDone` (`{kind:'move', taskId, status, index}` or
  `{kind:'update', taskId, patch}`) and return before any optimistic state change or store write.
  Confirm re-enters the same function with the note (`moveTask(..., note)` /
  `updateTask(id, {...patch, resultNote, completedAt})`), so the persistence path (proof update,
  then move, rollback on failure) is unchanged. Cancel clears `pendingDone`; nothing is written and
  the card stays in its column. A card that already has a note still moves straight through, as
  before (`updateTask` keeps the existing note + stamps `completedAt`, as the old code did).
- `completionRatePercent(done, total)`: `0` when `total` is 0, otherwise the old rounding. Empty
  board reads "0%"; all-done reads "100%".
- Dispatch semantics (BUILD-025) untouched: nothing here touches `board-dispatch.ts` or the store.
- No i18n: `KanbanBoard.tsx` has no `useTranslation`; all its strings are literal English, so the new
  strings follow that and no locale catalog changed.

## Tests (`kanban/KanbanBoard.test.tsx`, extended; happy-dom)
`KanbanColumn` and `KanbanDetailPanel` are replaced by small stand-ins that call the board's real
`onDrop` / `onUpdate` callbacks (the real column needs a DataTransfer drag). Source is an in-memory
fake; `window.prompt` is stubbed to return `null` like Electron.
1. Drop on Done opens an app dialog, `window.prompt` never called, no update/move written, card still
   in Review.
2. Cancel closes the dialog, card still in Review, not in Done, no writes.
3. Note submitted ("Mark done" disabled while empty) → `update` with trimmed `resultNote` +
   `completedAt`, `move('task-1','done',0)`, card shows in Done.
4. Detail panel status → Done: same dialog; cancel writes nothing; note → `update` with
   `status:'done'`, `resultNote`, `completedAt`.
5. Empty board, Analytics tab: "Completion rate" value is exactly "0%".

Mutation checks (each seen FAIL, then PASS restored):
- original `KanbanBoard.tsx` from HEAD → tests 1-5 fail (5 of 6; the load-error test passes).
- `moveTask` without the `return` after parking the request → 1, 2 fail.
- `updateTask` without the `return` → 4 fails.
- `completionRatePercent` without the zero guard → 5 fails.

## Verification
- `pnpm run typecheck` exit 0.
- `npx vitest run --config config/vitest.config.ts src/renderer/src/components/kanban/` → 4 files,
  33 tests passed.
- `oxlint` on the 3 files: only `max-lines` on `KanbanBoard.tsx` (pre-existing: 1007 counted lines
  at HEAD, 1022 now). The dialog went into its own file to keep the growth to +15. Splitting the
  board is out of scope. react-doctor config: clean.
- Full suite: deferred to the coordinator.

## Deviations
- New file `kanban/KanbanDoneNoteDialog.tsx` (spec named only `KanbanBoard.tsx`), to avoid growing an
  already over-limit file.
- The "Done needs a result note" toast on refusal is gone: refusal is now an explicit Cancel in the
  dialog, so the toast would only repeat what the user just chose.

## Rollback
Revert the commit. No data format or store change.

## Lessons
- Any `window.prompt/confirm/alert` in the renderer is a silent no-op in Electron; grep found no
  other use under `components/kanban/`.
