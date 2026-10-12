# REPAIR BUILD-004: show the true crew execution state in the UI (#119)

Spec: "BUILD-004" in `docs/stabilization/EXECUTION-ORDER.md` (branch `stabilize/iris-20260923`).

## Root cause
- Settings → Asana showed the Auto Mode switch as "on" from `asanaConfig.autoMode.enabled` alone. The crew pause gate (BUILD-001) blocks every Auto Mode run while the crew is paused, and the pane never said so.
- The Agents page only read `agents:getPaused` (a boolean). When `agents-config.json` exists but can't be read, BUILD-001 keeps the crew paused and makes `setAgentsPaused(false)` throw. The page still offered "Resume crew", which then failed with a generic toast and gave no file path.

## Fix
- `main/ipc/agents.ts`: new `agents:getExecutionState` returns `{paused, status, detail, filePath}` picked explicitly from `getAgentsControlState()` (no file contents). `agents:getPaused` is unchanged, and Kanban still uses it.
- `shared/agents.ts`: new `AgentsExecutionState` type so the renderer can use the same shape. It is exposed through preload `index.ts` and `api-types.ts`.
- `AgentsPage.tsx`: state now comes from `getExecutionState`. After a toggle, even a failed one, the state is re-read from main instead of trusting the `setPaused` return value.
- `AgentsPageHeader.tsx`: new `resumeBlocked` prop disables "Resume crew" when the file is unreadable. "Pause crew" is never disabled. New `CrewControlUnreadableNotice` shows a line under the header with the file path and the reason (errno or parse problem) when status is `unreadable`. It uses `text-destructive`, like the existing error lines in settings.
- `AsanaPane.tsx`: when Auto Mode is enabled and the crew is paused, a line under the Auto Mode description reads "Blocked: crew paused…". When the file is unreadable, it reads "Blocked: crew control file could not be read (<path>)…". The style is `text-destructive`. The keys are added to `en.json`, and other locales fall back.

## Tests
- New `renderer/.../settings/AsanaPane.test.tsx` (happy-dom, mocks `window.api`, Radix Select and the store):
  - enabled + paused shows "Blocked: crew paused"
  - enabled + unreadable shows the file path
  - enabled + running shows no note
  - disabled + paused shows no note
- New `renderer/.../agents/AgentsPageHeader.test.tsx`:
  - unreadable: Resume is disabled and a click does not call the handler
  - ordinary pause: Resume is enabled
  - Pause is always enabled
  - the notice shows the path and the reason
  - the notice renders nothing when status is ok
- Mutation checks. Each broke the tests as expected and was then restored:
  - M1: dropped the `paused` condition in AsanaPane, so the "running" test failed.
  - M2: never rendered the blocked text, so both "blocked" tests failed.
  - M3: removed `disabled` from the toggle, so the "disables Resume" test failed.
  - M4: rendered the notice for any state, so the "renders nothing" test failed.

## Verification
- `pnpm run typecheck`: exit 0.
- Targeted: `AsanaPane.test.tsx` and `AgentsPageHeader.test.tsx`, 2 files, 9 tests pass.
- oxlint (default and react-doctor) on every changed file is clean, except the pre-existing `max-lines` error in `AgentsPage.tsx` (see Deviations).
- Full suite: DEFERRED. The coordinator killed all vitest runs under machine load and will run the suite serially.

## Deviations
- The spec named the return shape `{paused, status, reason}`. It uses BUILD-001's field names instead, `{paused, status, detail, filePath}`, because the task brief asked for the file path to be shown.
- `AgentsPage.tsx` already broke `max-lines` before this build (411 lines against a 400 limit). It is now 418. Splitting the page is out of scope, so this is deferred to BUILD-049 (lint debt).
- The unreadable notice is a separate component rendered under the header, not inside it. Wrapping the header in a fragment would have re-indented the whole file.
- There is no unit test for the IPC handler. It is a four-line field pick, and there is no existing `ipc/agents.ts` test harness to extend. Typecheck enforces the shape.

## Rollback
Revert the commit. The gate keeps enforcing the pause. Only the labels and the disabled Resume go away.

## Lessons
- AsanaPane under happy-dom hangs on Radix Select, which loops through ref setState. Mock `../ui/select` and `../../store` (including `settingsSearchQuery`, which `SearchableSetting` reads).
