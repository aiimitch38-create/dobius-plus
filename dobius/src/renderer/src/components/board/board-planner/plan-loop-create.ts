import { translate } from '@/i18n/i18n'
import { LOOP_PLACEHOLDER_RRULE, newLoopState } from '../../../../../shared/automation-loops'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import { getRepoIdFromWorktreeId } from '../../../../../shared/worktree-id'
import { notifyAutomationsChanged } from '../board-loops/board-loop-list'
import type { PlannedLoop } from './plan-loop'

/** Saves a confirmed planner loop through the same two IPC calls the Loops studio uses. */
export async function createPlannedLoop(worktreeId: string, loop: PlannedLoop): Promise<void> {
  // Why: created disabled, then given its loop, so no scheduler tick can see it
  // as a plain scheduled automation in between (same as BoardLoopsPanel).
  const created = await window.api.automations.create({
    name: loop.form.name.trim() || translate('board.loops.untitled', 'Board loop'),
    prompt: loop.form.instruction.trim(),
    agentId: loop.agentKind && isTuiAgent(loop.agentKind) ? loop.agentKind : 'claude',
    projectId: getRepoIdFromWorktreeId(worktreeId),
    workspaceMode: 'existing',
    workspaceId: worktreeId,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    rrule: LOOP_PLACEHOLDER_RRULE,
    dtstart: Date.now(),
    enabled: false
  })
  await window.api.automations.update({
    id: created.id,
    updates: {
      loop: {
        worktreeId,
        trigger: loop.trigger,
        state: newLoopState(),
        background: loop.form.background,
        ...loop.stop
      },
      enabled: true
    }
  })
  notifyAutomationsChanged()
}
