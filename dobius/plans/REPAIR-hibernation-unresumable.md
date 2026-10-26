# REPAIR: agent hibernation strands panes it cannot resume

## Symptom
Switch to another workspace/project and back: Board cards remain, but agent
consoles are dead/blank and come back as plain shells.

## Root cause
- `shutdownCompletedAgentPaneForHibernation` (store/slices/terminals.ts ~1929)
  only checks that a sleep record EXISTS, not that it carries `resumeOwner`.
- `resumeOwner` is only built when the agent status entry has `launchToken`,
  `connectionId`, and a `ptyId` matching the layout leaf (agent-status.ts ~371).
- Wake (`buildColdRestoreAgentResumeStartup`, pty-connection.ts ~3600) returns
  null without `resumeOwner`, so the killed pane can never come back.
- Verified on this Mac: 6/6 persisted sleep records lack `resumeOwner`.

## Fix
1. terminals.ts: refuse to hibernate unless the record has `resumeOwner`.
2. agent-hibernation-planner.ts `getEligiblePane`: skip entries that could not
   produce a `resumeOwner` (no launchToken / connectionId / ptyId mismatch), so
   the coordinator doesn't retry and warn every tick.

## Test
- planner test: entry without launchToken -> no candidate.
- coordinator test: existing suites stay green.

## Out of scope (noted, not done)
- Counting glance-mode Board cards as foreground.
- Recovering the 6 already-stranded records.

## Rollback
Revert the single commit on `fix/hibernation-unresumable`.
