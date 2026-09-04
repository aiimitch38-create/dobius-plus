# TASK COMMS.4 — Review

## What changed

New file `dobius/src/renderer/src/components/communications/features/sidebar/ui/ChannelRowActionsMenu.tsx`
— a hover-revealed "more actions" button on each channel row, using the
shadcn `SidebarMenuAction` primitive (already shipped in this codebase's UI
kit at `shared/ui/sidebar.tsx`, `showOnHover` prop built in for exactly this
purpose, but unused anywhere until now). Opens a small `DropdownMenu` with
"Leave channel" / "Delete channel". Wired into both channel-row render
blocks in `CustomChannelSection.tsx` (`ChannelGroupSection` — the plain
"Channels"/"Starred"/"Forums" lists — and `CustomChannelSection` itself —
user-created sections), as a sibling of the existing `ChannelMenuButton` /
`DraggableChannelRow` inside each row's `SidebarMenuItem`.

## Why

Read in full: `plans/TASK-COMMS.4.md`, `IRIS-REPORT-20260904.md`. Traced
the actual sidebar component tree before assuming the plan's diagnosis was
complete, and found it undersold how much already existed:

- Both `ChannelGroupSection` and `CustomChannelSection` **already** wrap
  every channel row in a right-click `ContextMenu` whose content
  (`ChannelContextMenuItems`) already has a working "Delete channel" (gated
  by `canDeleteChannel`, a real moderation-capability check) and "Leave
  channel" — both already calling the real `delete_channel`/`leave_channel`
  commands, already wired end to end from `AppSidebar.tsx`
  (`onDeleteChannel={requestDeleteChannel}`, `onLeaveChannel={requestLeaveChannel}`)
  for Starred, Channels, and every custom section (Forums gets delete only,
  no leave — pre-existing, not in this task's scope to change).
- So the backend + menu-content plumbing genuinely was NOT missing, exactly
  as the plan said — but the plan's framing ("no per-channel-row context
  menu at all") undersold it: there already **is** one, reachable by
  right-click. The real gap is **discoverability**: `ChannelMenuButton`
  (the row itself) has zero visible affordance hinting that right-click
  does anything. Carson tried the only visible "⋮" he could see — the
  section-header one — which is section-scoped and doesn't have per-channel
  actions by design (confirmed in TASK-COMMS.4's own plan text).

Given that, the fix isn't "wire up delete" (already wired) — it's making
the already-working action **visible and clickable without needing to
already know about right-click**, per the plan's own alternative framing:
"a per-channel-row context menu (**or hover action**...) offering 'Delete
channel' and 'Leave channel', calling the already-working
delete_channel/leave_channel commands directly." Built the hover-action
version since a discoverable hover affordance was the actual gap, not a
second copy of the right-click menu.

Deliberately reused the **same** `onDeleteChannel`/`onLeaveChannel` handler
props and the **same** `useChannelModerationCapabilities` gating hook the
existing right-click menu already uses — not a parallel reimplementation.
A non-owner still never sees "Delete channel" in the new hover menu, same
as the right-click one. DMs are untouched (separate `SidebarSection`
component, separate `onHideDm` mechanism, out of this task's channel-delete
scope, matching the plan's own scoping).

Split the new component into its own file rather than inlining it in
`CustomChannelSection.tsx`: that file was already over its 400-line oxlint
cap (761 lines, pre-existing, confirmed via `git stash` bisection) before
this task touched it — per `AGENTS.md`'s explicit rule ("split the file...
instead" of suppressing `max-lines`), extracting the new component keeps
`CustomChannelSection.tsx`'s net growth to +11 lines (two 5-line call
sites) instead of the ~80 lines a fully inline version would have added.

## What I tested

- `pnpm --dir dobius run typecheck` — exit 0.
- `npx oxlint` on both touched files — the new file has zero findings;
  `CustomChannelSection.tsx` still trips the pre-existing `max-lines` cap
  (772 lines now vs. 761 baseline, confirmed via `git stash` bisection that
  every other finding is unchanged) — not fixable without a much larger,
  out-of-scope reorganization of an already-over-budget file; the +11 line
  growth here is deliberately minimized via the extraction above.
- **Not done**: the plan's live smoke test ("right-click (or hover-menu) an
  individual channel row, delete it, confirm it's actually gone after a
  reload"). Same constraint as TASK-COMMS.3: no DevTools/CDP on the
  currently-installed app (which predates this change anyway), and building
  + installing a fresh package is out of scope for routine per-task
  verification per this build's own guardrail. The backend command itself
  (`delete_channel`) was not touched by this task — it's the same path the
  pre-existing right-click menu already calls, so its correctness isn't new
  risk, but the actual visual hover-menu experience is unverified live.
  Flagging as owed in `HANDOFF.md`.
- No new unit test added: `ChannelRowActionsMenu.tsx` has no new business
  logic of its own — the delete-permission gating is entirely
  `useChannelModerationCapabilities` (pre-existing, unchanged, already
  relied on by the also-untested `ChannelContextMenuItems`). Zero React
  component-render tests exist anywhere in this comms module (checked
  before deciding this — no `@testing-library/react` usage, no `render(<`
  calls in any `.test.*` file under `communications/`), so adding one here
  would be a new testing paradigm for this module, not a fix within scope.

## Risk for a human reviewer to double-check

- Once installed: hover a channel row, confirm the "⋮" appears, click it,
  confirm "Delete channel" only shows for channels Carson owns/can manage,
  and that clicking it actually removes the channel after a reload (not
  just an optimistic UI removal that reverts) — this is the live check the
  plan asked for and this session could not perform.
- `SidebarMenuAction`'s `showOnHover` CSS relies on the `group/menu-item`
  class already present on `SidebarMenuItem` (verified by reading
  `shared/ui/sidebar.tsx`) — worth a visual confirmation that the button
  doesn't flash/jump given it's a new element in previously-established
  row markup.
