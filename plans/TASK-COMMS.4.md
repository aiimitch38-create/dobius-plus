# TASK COMMS.4 — Delete channel needs a direct entry point

Source: `IRIS-REPORT-20260904.md`. Independent of TASK COMMS.1/.2/.3 —
different files, lowest severity, do last.

## What

No way to delete an individual channel from the sidebar.

## Why

Not missing — misplaced. Backend (`case "delete_channel"`,
`dobiusCommunications.ts:2994` → `deleteDobiusChannel(args)`) and a "Delete
channel" UI action both already exist, inside
`ChannelManagementSheet.tsx` / `ChannelManagementModerationActions.tsx`,
reached by opening a channel → "⋮" → "Manage channel."

The menu Carson tried (sidebar "Channels" section-header dropdown,
screenshot showed only "Sort") is a different, section-level menu —
`SectionActionsMenu` in
`dobius/src/renderer/src/components/communications/.../CustomChannelSection.tsx:120-269`
— documented as the single "more actions" menu for an entire sidebar
**section** (mark-all-read, browse, create, rename/move/delete **section**,
sort). It has no per-channel-row context menu at all.

## Fix

Add a per-channel-row context menu (or hover action, matching whatever
interaction pattern the rest of this sidebar already uses for per-row
actions) offering "Delete channel" and "Leave channel", calling the
already-working `delete_channel` / `leave_channel` commands directly.

## Test

Live smoke test: right-click (or hover-menu) an individual channel row in
the sidebar, delete it, confirm it's actually gone after a reload (not just
an optimistic UI removal that reverts) and that the backend command ran.

## Guardrails

- Do not touch `SectionActionsMenu` — it's working as designed for
  section-level actions. This is a missing sibling entry point, not a bug in
  it.
- Do not touch `ChannelManagementSheet.tsx`'s existing "Manage channel" path
  — it keeps working exactly as it does now; this task adds a faster
  shortcut, not a replacement.
- Minimal diff.
