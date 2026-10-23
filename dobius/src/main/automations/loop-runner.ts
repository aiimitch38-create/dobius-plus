import type { Store } from '../persistence'
import type {
  Automation,
  AutomationLoop,
  AutomationLoopState,
  AutomationLoopTarget,
  AutomationRun
} from '../../shared/automations-types'
import {
  admitGoalStep,
  admitLoopFire,
  admitOutputMatch,
  buildGoalPrompt,
  normalizeAutomationLoop,
  readGoalVerdict,
  validateLoopPattern
} from '../../shared/automation-loops'
import { loopTimeUp, scheduleDue } from '../../shared/automation-loop-schedule'
import { checkExecutionAdmission } from '../agents/execution-gate'
import { boardGroupTabIdsByName, loopTargetTabIdsFromBoards } from './board-group-members'
import { setCustomGroupResolver } from '../runtime/orchestration/groups'
import type { LoopDeliveryStatus, LoopTerminals } from './loop-terminals'
import { matchLoopPattern } from './loop-pattern-match'
import { HELD_RESULT, LoopHolds, heldFiredAt, notifyLoopHeldByDefault } from './loop-hold'

// Board loops ride the existing automation records: each fire is an
// AutomationRun (trigger = loop kind) so history, last result and deletion
// behave like scheduled automations. Delivery types the loop's instruction
// into the target consoles instead of launching a new agent session.

// Why: output-match and goal loops react to terminal output; a minute is too slow.
const LOOP_TICK_MS = 5 * 1000

const DELIVERY_ERROR: Record<Exclude<LoopDeliveryStatus, 'sent'>, string> = {
  'no-agent': 'Agent not running.',
  'no-terminal': 'Console is not open.',
  permission: 'Agent is waiting for permission.',
  'not-writable': 'Console did not accept input.'
}

type LoopStore = Pick<
  Store,
  'listAutomations' | 'createAutomationRun' | 'updateAutomationRun' | 'updateAutomation' | 'getUI'
>

export class LoopRunner {
  private ticking = false
  private readonly holds: LoopHolds

  constructor(
    private readonly store: LoopStore,
    private readonly terminals: LoopTerminals | null,
    notifyHeld: (loopName: string) => void = notifyLoopHeldByDefault
  ) {
    this.holds = new LoopHolds(notifyHeld)
  }

  private timer: ReturnType<typeof setInterval> | null = null

  start(): void {
    // Why: "@Team A" relays resolve Board groups from the persisted boards, the
    // same source the renderer writes, so membership never needs syncing.
    setCustomGroupResolver((name, worktreeId) =>
      boardGroupTabIdsByName(this.store.getUI().boardsByWorktree, name, worktreeId)
    )
    this.timer ??= setInterval(() => {
      void this.tick()
    }, LOOP_TICK_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** "Run now" and renderer on-idle fires. A loop relays into board consoles; it
   *  must never fall through to the dispatch path that launches a new agent. */
  async runNow(automation: Automation): Promise<AutomationRun> {
    const run = automation.enabled ? await this.fireFromRequest(automation) : null
    if (!run) {
      throw new Error('loop_not_admitted')
    }
    return run
  }

  /** Renderer-observed fires (on-idle) and "Run now" from the UI. */
  async fireFromRequest(automation: Automation, now = Date.now()): Promise<AutomationRun | null> {
    const loop = normalizeAutomationLoop(automation.loop)
    if (!loop) {
      return null
    }
    if (loopTimeUp(loop, automation.createdAt, now)) {
      return null
    }
    const minGap = loop.trigger.kind === 'on-idle' ? loop.trigger.debounceMs : 0
    // Why: two windows can observe the same idle transition; the gap dedupes them.
    if (!admitLoopFire(loop.state, now, minGap)) {
      return null
    }
    const instruction =
      loop.trigger.kind === 'goal' ? buildGoalPrompt(loop.trigger.goal) : automation.prompt
    return await this.fire(automation, loop, now, instruction, loop.state)
  }

  /** Main-side triggers: output-match and goal. Called from the service tick. */
  async tick(now = Date.now()): Promise<void> {
    if (this.ticking || !this.terminals) {
      return
    }
    this.ticking = true
    try {
      for (const automation of this.store.listAutomations()) {
        const loop = normalizeAutomationLoop(automation.loop)
        if (!automation.enabled || !loop || loop.state.paused || loop.state.retiredAt !== null) {
          continue
        }
        if (loopTimeUp(loop, automation.createdAt, now)) {
          this.saveState(automation, loop, {
            ...loop.state,
            retiredAt: now,
            lastResult: 'Time limit reached; loop finished.'
          })
          continue
        }
        try {
          if (loop.trigger.kind === 'on-output-match') {
            await this.tickOutputMatch(automation, loop, now)
          } else if (loop.trigger.kind === 'goal') {
            await this.tickGoal(automation, loop, now)
          } else if (
            loop.trigger.kind === 'schedule' &&
            scheduleDue(loop.state, automation.createdAt, now, loop.trigger.everyMs)
          ) {
            await this.fire(automation, loop, now, automation.prompt, loop.state)
          }
        } catch (error) {
          console.error('[board-loops] loop tick failed', automation.id, error)
        }
      }
    } finally {
      this.ticking = false
    }
  }

  private async tickOutputMatch(
    automation: Automation,
    loop: AutomationLoop,
    now: number
  ): Promise<void> {
    if (loop.trigger.kind !== 'on-output-match') {
      return
    }
    const { pattern } = loop.trigger
    const read = validateLoopPattern(pattern).ok
      ? await this.terminals!.read(loop.trigger.tabId, loop.state.outputCursor)
      : null
    if (!read) {
      return
    }
    const hadCursor = loop.state.outputCursor !== null
    const match = hadCursor ? matchLoopPattern(pattern, read.lines) : ({ kind: 'none' } as const)
    // Why: the cursor always moves past what was just judged, fire or not, so
    // the same output range can never fire twice.
    const advanced: AutomationLoopState = { ...loop.state, outputCursor: read.cursor }
    if (match.kind === 'timeout') {
      // A pattern that blew its time budget would do it again every tick: stop the loop.
      this.store.updateAutomation(automation.id, {
        enabled: false,
        loop: {
          ...loop,
          state: { ...advanced, lastResult: 'Pattern took too long to match; loop paused.' }
        }
      })
      return
    }
    const decision = admitOutputMatch({
      state: loop.state,
      hadCursor,
      matched: match.kind === 'match',
      now,
      cooldownMs: loop.trigger.cooldownMs
    })
    if (!decision.fire) {
      if (read.cursor !== loop.state.outputCursor) {
        this.saveState(automation, loop, advanced)
      }
      return
    }
    // Why: never echo terminal output back into a terminal; only the user's own
    // instruction is delivered.
    await this.fire(automation, loop, now, automation.prompt, advanced)
  }

  private async tickGoal(automation: Automation, loop: AutomationLoop, now: number): Promise<void> {
    if (loop.trigger.kind !== 'goal') {
      return
    }
    const [watchTab] = this.resolveTabIds(loop.trigger.target, loop.worktreeId)
    const read = watchTab ? await this.terminals!.read(watchTab, loop.state.outputCursor) : null
    if (!read) {
      return
    }
    const verdict = readGoalVerdict(read.lines) ?? loop.state.lastVerdict
    const state: AutomationLoopState = {
      ...loop.state,
      outputCursor: read.cursor,
      lastVerdict: verdict
    }
    const decision = admitGoalStep({
      state,
      verdict,
      now,
      checkEveryMs: loop.trigger.checkEveryMs,
      maxRuns: loop.trigger.maxRuns
    })
    if (decision === 'fire') {
      await this.fire(automation, loop, now, buildGoalPrompt(loop.trigger.goal), {
        ...state,
        lastVerdict: null
      })
      return
    }
    if (decision === 'retire-met' || decision === 'retire-exhausted') {
      this.saveState(automation, loop, {
        ...state,
        retiredAt: now,
        lastResult:
          decision === 'retire-met'
            ? 'Goal met.'
            : `Stopped after ${state.runCount} runs; goal not met.`
      })
      return
    }
    if (
      state.outputCursor !== loop.state.outputCursor ||
      state.lastVerdict !== loop.state.lastVerdict
    ) {
      this.saveState(automation, loop, state)
    }
  }

  private resolveTabIds(target: AutomationLoopTarget, worktreeId: string): string[] {
    return loopTargetTabIdsFromBoards(this.store.getUI().boardsByWorktree, target, worktreeId)
  }

  private async fire(
    automation: Automation,
    loop: AutomationLoop,
    now: number,
    instruction: string,
    baseState: AutomationLoopState
  ): Promise<AutomationRun> {
    const run = this.store.createAutomationRun(automation, now, loop.trigger.kind)
    const tabIds =
      loop.trigger.kind === 'on-output-match'
        ? [loop.trigger.tabId]
        : this.resolveTabIds(loop.trigger.target, loop.worktreeId)
    const admission = checkExecutionAdmission('agent-run')
    const blocked = !admission.allowed
    let error: string | null = null
    let delivered = 0
    let agentMissing = false
    let waitingOnYou = false
    if (!this.terminals) {
      error = 'Board terminal access is not connected.'
    } else if (!admission.allowed) {
      error = admission.message ?? 'Autonomous runs are paused.'
    } else if (tabIds.length === 0) {
      error = 'The loop target has no consoles.'
    } else {
      for (const tabId of tabIds) {
        try {
          const status = await this.terminals.deliver(tabId, instruction)
          if (status === 'sent') {
            delivered += 1
          } else {
            agentMissing ||= status === 'no-agent' || status === 'no-terminal'
            waitingOnYou ||= status === 'permission'
            error = DELIVERY_ERROR[status]
          }
        } catch (sendError) {
          error = sendError instanceof Error ? sendError.message : String(sendError)
        }
      }
      if (delivered === 0) {
        error ??= 'No target console is running.'
      }
    }
    const heldNow = delivered === 0 && waitingOnYou
    this.holds.track(automation.id, automation.name, heldNow)
    const lastResult =
      delivered > 0
        ? `Sent to ${delivered} of ${tabIds.length} console(s).`
        : heldNow
          ? HELD_RESULT
          : error
    // Why: a skipped fire still counts toward the gap so a stuck target can't spin.
    this.saveState(automation, loop, {
      ...baseState,
      runCount: baseState.runCount + (delivered > 0 ? 1 : 0),
      lastFiredAt: heldFiredAt(loop.trigger, now, heldNow),
      lastResult
    })
    return this.store.updateAutomationRun({
      runId: run.id,
      status:
        delivered > 0
          ? 'completed'
          : blocked || !this.terminals || agentMissing
            ? 'skipped_unavailable'
            : 'dispatch_failed',
      workspaceId: loop.worktreeId,
      terminalSessionId: tabIds[0] ?? null,
      error: delivered > 0 ? null : error
    })
  }

  private saveState(
    automation: Automation,
    loop: AutomationLoop,
    state: AutomationLoopState
  ): void {
    this.store.updateAutomation(automation.id, { loop: { ...loop, state } })
  }
}
