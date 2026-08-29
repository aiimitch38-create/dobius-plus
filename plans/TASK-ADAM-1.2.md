# TASK-ADAM-1.2 — Shell tool: execution and window approval

Wires the TASK-ADAM-1.1 classifier to execution. Still no IPC and no tool
registration — those are TASK-ADAM-1.3.

## Algorithm gate

1. **QUESTION.** Does the pending-command queue need to exist, or could a
   writing command open the window and execute inline on approval? It needs to
   exist: the approval arrives on a different IPC call from a different renderer
   process, so the argv has to survive between the two. Kept.
   Questioned and **cut**: re-classifying at execution time. `propose` is the
   only writer to the queue and it never queues a `denied` verdict, and
   `classifyShellCommand` is deterministic on argv — the second call could not
   return anything different. Defensive clutter, deleted.
2. **DELETE.** No persistence (a pending command must not survive a restart —
   same reasoning as `SelfEditStore`'s in-memory map). No queue size limit, no
   expiry timer: the window shows one command at a time and a stale id is
   already refused.
3. **SIMPLIFY.** `execFile` runner copies `runCli` (`agent-context.ts:78`)
   including its error/output handling. The review window is the existing
   self-edit window with a second channel, not a new BrowserWindow.

## What

**New `dobius/src/main/jarvis/shell-command-store.ts`.** Kept out of
`shell-tool.ts` so that file stays pure classification and both stay under the
300-line `max-lines` cap.

- Read-only → runs immediately. `execFile` with the argv array, 30s timeout,
  output capped at 4,000 chars.
- Writing → queued as a `PendingShellCommand` with an id; the caller gets back
  the command for display, and TASK-ADAM-1.3 shows it in the review window.
- Denied → never queued, never executed; the reason goes back to the agent.

**Modified `dobius/src/main/window/self-edit-window.ts`.** Adds
`SHELL_COMMAND_PROPOSAL_CHANNEL` and `showShellCommandProposal(payload)`
alongside the diff variant, both reusing the one review window. The window title
is set per payload so a command proposal does not read "Adam is editing his
code".

**Modified `dobius/src/renderer/src/components/jarvis/SelfEditView.tsx`.** A
branch that renders a command proposal — the argv, one argument per line so a
long path cannot be visually smuggled past the reader — with Run / Discard.

**Split of the IPC surface between 1.2 and 1.3.** The build file lists both
`jarvis:proposeShell` and `jarvis:runApprovedShell` under TASK-ADAM-1.3, but the
review-window branch above cannot typecheck without the preload calls it makes.
The boundary used instead is **who the surface serves**:

- **1.2 — the human's half.** `jarvis:runApprovedShell`,
  `jarvis:discardShellCommand`, and the `onShellCommandProposal` subscription,
  plus their preload entries. These belong to the review window.
- **1.3 — the agent's half.** `jarvis:proposeShell`, its preload entry, the
  `propose_shell` client tool, and the ElevenLabs tool registration. The WIRING
  CHECK runs there, over every channel and tool name from both tasks.

This also puts invariant A's third layer in the task that creates the channel it
guards.

## Invariant A — enforced twice, structurally

The build file requires that no client tool can cause execution. Rather than
only *omitting* such a tool, this task makes the tool impossible to write:

1. **The agent is never told the pending command's id.** `describeForAgent()`
   produces the agent-facing string and it contains no id — the id travels only
   on the payload sent to the review window. A client tool would have nothing to
   pass to an execute call. (`SelfEditStore` does the opposite: it returns the
   proposal id to the agent, which is why `apply_code_change` is possible there.)
2. **Deleted-before-run.** `runApproved(id)` removes the entry from the queue
   before executing, so an id cannot be replayed to run a command twice.

3. **Sender identity.** `jarvis:runApprovedShell` refuses any caller whose
   `event.sender` is not the review window's own `webContents`. The agent's
   client tools run in the main window's renderer, so even a tool that somehow
   obtained an id could not execute it.

## Test

`shell-command-store.test.ts` (no electron import — `self-edit-window.ts` loads
`electron` at runtime, and a test importing it would become a SECOND failing
file on top of the known `attach-main-window-services.test.ts`):

- a read-only command runs and returns its output
- output over the cap is truncated
- **an unapproved writing command never executes** — asserted on the side
  effect: the file it would have created does not exist after `propose`
- the same command DOES create that file after `runApproved`, so the previous
  test is proving the gate and not a broken runner
- a denied command is not queued at all (queue length 0) and never runs
- an id cannot be run twice
- an unknown / discarded id is refused
- `describeForAgent` never leaks the id (invariant A, layer 1)

## Risks

- **The window is shared with self-edit.** A command proposal arriving while a
  diff is on screen replaces it. Acceptable: one review surface, one decision at
  a time, and the discarded diff is still in the store.
- **30s timeout on a read-only command blocks the agent's turn.** Accepted —
  `runCli` already has the same shape with a 12s timeout, and the alternative
  (streaming) is a much larger change for a voice interface that cannot read
  streaming output aloud anyway.

## Estimate

~130 lines of source, ~150 of test, plus ~40 in the window and view.
