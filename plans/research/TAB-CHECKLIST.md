# Live to-do checklist on each agent's tab and console card (plan 8.9)

Research only. No app code changed. Written 2026-11-21 by the research worker for task `task_a463f70bfd87`.

Read first: `plans/WORKSTATION-BUILD-PLAN.md` (Phase 8, row 8.9), `plans/DOBIUS-AGENTIC-BUILD-PLAN.md` (C3), `plans/research/AGENT-ACTIVITY-FEED.md`.
Paths below are relative to `dobius/src/` on the workstation line (`/Users/bayou/Projects (Code)/dobius-plus/WB-plan2-research2`).

## Plain-English terms

- **Hook** (a small script Claude Code runs on events, such as before or after a tool call. It reports to Dobius).
- **Hook payload** (the data a hook sends with each event).
- **TodoWrite** (Claude Code's built-in tool that writes the agent's to-do list).
- **Pane** (one terminal split inside a tab. Each pane has its own key, `tabId:leafId`).
- **Console card** (the board card that shows one agent's terminal).
- **Glance mode** (the small, zoomed-out view of a console card).
- **Store** (the app's shared in-memory state; the renderer is the window that draws the screen).

## Short answer

- The data is already arriving. The hook server keeps `toolName` and a short `toolInput` preview per pane (`main/agent-hooks/server.ts`, parsed in `shared/agent-status-types.ts:436-461`).
- But `toolInput` is capped at 160 characters and has newlines collapsed (`shared/agent-status-types.ts:211` and `:452`). A full to-do list will not fit in it.
- The fix follows an existing pattern. `interactivePrompt` already carries an uncapped JSON copy of the AskUserQuestion input (cap 16,000 characters). A `todos` field can do the same for TodoWrite.
- Status lives only in renderer memory (`store/slices/agent-status.ts:93`). It is not saved to disk. The list will reset on app restart until the agent writes again.
- There is no board right-rail checklist panel on this line. The "checklist" cards on the board are a user-made card type (`board/cards/ChecklistCard.tsx`), not agent work.

## Findings

### 1. Where hook payloads arrive (verified)

- Hook server: `main/agent-hooks/server.ts` (1,689 lines). Recognizes `PreToolUse`, `PostToolUse`, `PostToolUseFailure` as tool-progress events (`:139`).
- Incoming envelope type has `hookEventName`, `toolUseId`, `toolAgentId`, `payload: unknown`, and `tabId` / `worktreeId` / `launchToken` (around `server.ts:1055-1075`).
- Entry points that consume it: `main/index.ts:149`, `main/persistence.ts:132`, `main/ipc/pty.ts:42`, `main/ipc/agent-hooks.ts:9`.
- IPC channels live in `main/ipc/agent-hooks.ts` (one per agent type, e.g. `agentHooks:claudeStatus`, `:136`).
- Renderer receives it into `renderer/src/store/slices/agent-status.ts` (the slice writes `agentStatusByPaneKey` at `:1336`).
- The payload parser: `shared/agent-status-types.ts:436-461`. Fields read: `state`, `prompt`, `agentType`, `toolName` (cap 60), `toolInput` (cap 160, `:452`), `interactivePrompt` (cap 16,000, `:454-457`), `lastAssistantMessage` (cap 8,000).
- Hook listener (the main-side merge step): `shared/agent-hook-listener.ts:415-419` (the `interactivePrompt` field) and `:455-458` (deliberately not inherited from the previous event, so a stale question does not linger).

### 2. TodoWrite is not read anywhere (verified by grep)

- `TodoWrite` appears in one tool-name list (`shared/agents.ts:105`). I did not read what that list is for.
- No code in `main/` or `renderer/src/` parses a TodoWrite call. The native chat (`renderer/src/components/native-chat/`) has no to-do rendering (grep for "todo" and "checklist" found none).
- Also in `plans/REPAIR-BUILD-007-run-capability-profiles.md` (a plan note, not code).

### 3. The `toolInput` field cannot carry a checklist (verified)

- `AGENT_STATUS_TOOL_INPUT_MAX_LENGTH = 160` (`shared/agent-status-types.ts:211`). `normalizeOptionalField` collapses newlines and truncates (`:452`).
- The `AgentStatusEntry` type says so explicitly (`:115`: "Short preview of the tool input").
- The AskUserQuestion precedent (`:116-121` and `:221-226`): a separate field that is "NOT truncated to a short preview", with its own cap (16,000).

### 4. Where the status is kept (verified)

- `agentStatusByPaneKey: Record<string, AgentStatusEntry>` in `renderer/src/store/slices/agent-status.ts:94`.
- Comment on the same slice: "Real-time only — lives in renderer memory, not persisted to disk." (`:93`).
- The pane key is `tabId:leafId` (`shared/agent-status-types.ts:91`).
- Status history is capped at `AGENT_STATE_HISTORY_MAX` (`shared/agent-status-types.ts:62`), so per-pane memory is bounded.

### 5. Where a checklist would render (verified)

- Console card: `renderer/src/components/board/console-card/ConsoleCard.tsx` (145 lines). It already shows `ConsoleAccountBadge` (`:118`) in the header area.
- Body: `ConsoleCardBody.tsx` (313 lines). The body region is at `:246-302`.
- Glance mode: `ConsoleGlance.tsx` (163 lines). The glance body is sized `{ w: 220, h: 120 }` (`console-render-plan.ts:22`). Two modes: `'live' | 'glance'` (`console-render-plan.ts:26`).
- Live status hook: `console-card/use-console-card-status.ts`. It reads `agentStatusByPaneKey[paneKey]` (`:16`) and returns `status` and `lastReply` (`:11-22`). The same status feeds the card header, the Mission Map and the orchestrator rows. A checklist can use the same hook.
- Board side rails: `BoardToolRail` sits on the left (`board-chrome/BoardToolRail.tsx:127`, `left-4`). `BoardInsertRail` sits on the right (`board-chrome/BoardInsertRail.tsx:61`, `right-4`) and holds insert buttons, not agent state.
- So the "board right-rail checklist panel" in the brief does not exist on this line. Nothing here covers part of 8.9.

### 6. Other points (verified unless marked)

- The state dot and "smart-attention" named in plan C3 (`AgentStateDot`, `smart-attention`) were not checked in this pass.
- The TodoWrite input shape (a `todos` list with `content`, `status`, `activeForm`) is what Claude Code sends. This is from my knowledge of Claude Code, not from this repo. Confirm with one real hook payload before building. (Inferred.)

## Recommended design

1. **Carry the full list as its own field, the same way AskUserQuestion does.** Add `todos?: string` (JSON) to the payload parser (`shared/agent-status-types.ts:436-461`), to `AgentStatusEntry` (`:75`), and to the hook listener merge (`shared/agent-hook-listener.ts:415`). Use a cap of about 16,000 characters. Set it from each TodoWrite event and clear it when the turn ends. This is a full snapshot each time, so it should replace the previous value, not merge.
2. **Store it per pane, in memory only, like status.** It goes into `agentStatusByPaneKey` via the existing slice (`agent-status.ts:1336`). No new storage. Accept that a restart clears it until the next TodoWrite.
3. **Render it in two places, using the status hook already there.**
   - Glance mode: one line, "3 of 7 done", with the current item. Fits the 220 x 120 glance body.
   - Live mode: a short list under the header (`ConsoleCardBody.tsx`, below the header area), collapsed by default.
   - Read it through `use-console-card-status.ts` (or a sibling hook) so the header, Mission Map and orchestrator rows stay in step.
4. **Do not make a new board panel for v1.** The plan's "right-rail" is not on this line. A panel would be a new surface. Put the list on the card first, then decide.
5. **Test with a real payload first.** Capture one TodoWrite hook payload from a live Claude Code session (through the existing hook log) before writing the parser. Confirm the JSON shape.

## Task list

Sizes: S = under half a day, M = one to two days, L = longer.

1. (S) Capture one real TodoWrite hook payload and save it as a test fixture. Files: a new `dobius/src/shared/agent-status-fixtures/todowrite.json` (or put it inline in the test). Confirms the shape before any code.
2. (S) Add the `todos` field: payload parse, entry type, cap constant. Files: `dobius/src/shared/agent-status-types.ts` (`:75`, `:157-170`, `:211` area for the new cap, parse at `:436-461`), `dobius/src/shared/agent-hook-listener.ts` (`:415-419`, `:455-458`). Tests beside them: `dobius/src/shared/agent-status-types.test.ts` (if present; otherwise a new one).
3. (S) Carry it through the store. Files: `dobius/src/renderer/src/store/slices/agent-status.ts` (`:94`, set near `:1336`).
4. (S) Add a hook to read the list for one console. Files: new `dobius/src/renderer/src/components/board/console-card/use-console-todos.ts`, modeled on `use-console-card-status.ts`.
5. (M) Render in glance mode and live mode. Files: `dobius/src/renderer/src/components/board/console-card/ConsoleGlance.tsx` (one line), `dobius/src/renderer/src/components/board/console-card/ConsoleCardBody.tsx` (list below header, collapsed by default). Test: `ConsoleCardBody.test.tsx` (existing, 174 lines), `ConsoleGlance.test.tsx` (existing).
6. (S) Clear the list when the turn ends or the pane resets. Files: `shared/agent-hook-listener.ts` (merge rule), `renderer/src/store/slices/agent-status.ts`.
7. (S) Verify on screen: a fresh Visual window per the screenshot rule, show a console card with a live list. Screenshot to the task report.

## Open questions for Carson

1. Should the checklist show only on the console card, or also on the tab itself (the tab bar)? (Recommend: console card first.)
2. Is it enough that the list resets when Dobius restarts? (Recommend yes for v1. Persisting it means a new save path.)
3. Plan C3 wants each item to show working / waiting / permission / blocked / done. TodoWrite only has pending / in progress / completed. Should "permission" and "blocked" come from the existing pane state (`AgentStateDot`) next to the list? (Recommend yes; no new state needed.)
4. The brief says the board has a right-rail checklist panel. It does not on this line. Was that meant to be the Kanban In-Progress column, or a panel on another branch? Please confirm which one to build against.
5. The plan's audit file `plans/research/IRIS-PLAN-AUDIT-20261121.md` is not in this checkout. Do you want me to re-run this with that audit as an input?

## Confidence

- Verified (read in source or grep): the hook server and payload path; the 160-character `toolInput` cap; the AskUserQuestion precedent and its 16,000 cap; the renderer-only storage; the console card files and render modes; the absence of any TodoWrite parsing and any board right-rail checklist.
- Inferred (not checked in this repo): the TodoWrite JSON shape; that Claude Code sends the full list on every TodoWrite call.
- Not checked: `AgentStateDot` and "smart-attention" from plan C3; the purpose of the `shared/agents.ts:105` tool list.
