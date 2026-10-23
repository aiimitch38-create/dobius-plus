import type { Store } from '../persistence'
import type {
  Automation,
  AutomationLoop,
  AutomationLoopState,
  AutomationRun
} from '../../shared/automations-types'
import {
  admitLoopFire,
  admitOutputMatch,
  normalizeAutomationLoop,
  validateLoopPattern
} from '../../shared/automation-loops'
import { loopTimeUp, scheduleDue } from '../../shared/automation-loop-schedule'
import { stopStateAfterRun } from '../../shared/automation-loop-stop'
import { checkExecutionAdmission } from '../agents/execution-gate'
import { boardGroupTabIdsByName, loopTabIdsFromBoards } from './board-group-members'
import { setCustomGroupResolver } from '../runtime/orchestration/groups'
import type { LoopDeliveryStatus, LoopTerminals } from './loop-terminals'
import { matchLoopPattern } from './loop-pattern-match'
import { HELD_RESULT, LoopHolds, heldFiredAt, notifyLoopHeldByDefault } from './loop-hold'
import {
  LoopStopChecks,
  anyWorking,
  type LoopStopChecksOptions,
  type StopCheckStore
} from './loop-stop-check'
import { loopInstruction, loopRunsInBackground } from '../../shared/automation-loop-judge'
import { LoopBoardVisibility } from './loop-board-visibility'
import type { LoopGoalJudge } from './loop-goal-judge'
import { LoopGoalJudging } from './loop-goal-judging'

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

type LoopStore = StopCheckStore & Pick<Store, 'createAutomationRun' | 'updateAutomationRun'>

export class LoopRunner {
  private ticking = false
  private readonly holds: LoopHolds
  private readonly stopChecks: LoopStopChecks
  private readonly goals: LoopGoalJudging
  private readonly visibility = new LoopBoardVisibility()

  constructor(
    private readonly store: LoopStore,
    private readonly terminals: LoopTerminals | null,
    notifyHeld: (loopName: string) => void = notifyLoopHeldByDefault,
    opts: LoopStopChecksOptions & { judge?: LoopGoalJudge } = {}
  ) {
    this.holds = new LoopHolds(notifyHeld)
    this.stopChecks = new LoopStopChecks(store, opts)
    this.goals = new LoopGoalJudging(
      store,
      {
        fire: (...args) => this.fire(...args),
        saveState: (...args) => this.saveState(...args),
        resolveTabIds: (loop) => loopTabIdsFromBoards(this.store.getUI().boardsByWorktree, loop)
      },
      opts.judge
    )
  }

  /** Renderer heartbeat: whether a window shows this worktree's Board right now. */
  setBoardVisible(worktreeId: string, senderId: string, visible: boolean, now = Date.now()): void {
    this.visibility.report(worktreeId, senderId, visible, now)
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
    const instruction = loopInstruction(loop.trigger, automation.prompt)
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
        const visible = this.visibility.isVisible(loop.worktreeId, now)
        try {
          if (await this.stopChecks.tick(automation, loop, now, this.terminals)) {
            continue
          }
          // "Keep running behind other tabs" off: the loop waits with its Board, then catches up.
          if (!visible && !loopRunsInBackground(loop)) {
            continue
          }
          if (loop.trigger.kind === 'on-output-match') {
            await this.tickOutputMatch(automation, loop, now)
          } else if (loop.trigger.kind === 'goal') {
            await this.goals.tick(automation, loop, now, this.terminals)
          } else if (loop.trigger.kind === 'on-idle') {
            await this.tickHiddenIdle(automation, loop, now, visible)
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
    const advanced: AutomationLoopState = {
      ...loop.state,
      outputCursor: read.cursor
    }
    if (match.kind === 'timeout') {
      // A pattern that blew its time budget would do it again every tick: stop the loop.
      this.store.updateAutomation(automation.id, {
        enabled: false,
        loop: {
          ...loop,
          state: {
            ...advanced,
            lastResult: 'Pattern took too long to match; loop paused.'
          }
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

  /** On-idle while the Board is hidden (the renderer observer covers it when visible). */
  private async tickHiddenIdle(
    automation: Automation,
    loop: AutomationLoop,
    now: number,
    visible: boolean
  ): Promise<void> {
    if (loop.trigger.kind !== 'on-idle' || visible) {
      this.visibility.resetIdle(automation.id)
      return
    }
    const tabIds = loopTabIdsFromBoards(this.store.getUI().boardsByWorktree, loop)
    const working = await anyWorking(this.terminals, tabIds)
    const { debounceMs } = loop.trigger
    if (
      this.visibility.stepIdle(automation.id, working, now, debounceMs) &&
      admitLoopFire(loop.state, now, debounceMs)
    ) {
      await this.fire(automation, loop, now, automation.prompt, loop.state)
    }
  }

  private async fire(
    automation: Automation,
    loop: AutomationLoop,
    now: number,
    instruction: string,
    baseState: AutomationLoopState
  ): Promise<AutomationRun> {
    const run = this.store.createAutomationRun(automation, now, loop.trigger.kind)
    const tabIds = loopTabIdsFromBoards(this.store.getUI().boardsByWorktree, loop)
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
      lastResult,
      ...(delivered > 0 ? stopStateAfterRun(loop, baseState.runCount + 1, now, lastResult) : {})
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
