import type {
  Automation,
  AutomationLoop,
  AutomationLoopState
} from '../../shared/automations-types'
import {
  admitGoalStep,
  normalizeAutomationLoop,
  readGoalVerdict
} from '../../shared/automation-loops'
import {
  appendJudgeTranscript,
  judgeDue,
  loopInstruction
} from '../../shared/automation-loop-judge'
import { checkExecutionAdmission } from '../agents/execution-gate'
import { createClaudeGoalJudge, type LoopGoalJudge } from './loop-goal-judge'
import type { LoopTerminals } from './loop-terminals'
import { anyWorking, type StopCheckStore } from './loop-stop-check'

export type JudgedGoalHost = {
  /** Delivers one run to the loop's consoles (the runner's normal fire path). */
  fire: (
    automation: Automation,
    loop: AutomationLoop,
    now: number,
    instruction: string,
    baseState: AutomationLoopState
  ) => Promise<unknown>
  saveState: (automation: Automation, loop: AutomationLoop, state: AutomationLoopState) => void
  resolveTabIds: (loop: AutomationLoop) => string[]
}

/**
 * Goal loops. Self-reported goals read the console's DOBIUS_GOAL line; judged
 * goals ask a separate judge session instead. The judge runs in the background,
 * one at a time per loop, and only ever returns a verdict: it never touches a
 * terminal.
 */
export class LoopGoalJudging {
  private readonly judge: LoopGoalJudge
  private readonly judging = new Set<string>()
  /** Console output since each loop's last run; what the judge reads. */
  private readonly transcripts = new Map<string, string[]>()

  constructor(
    private readonly store: StopCheckStore,
    private readonly host: JudgedGoalHost,
    judge?: LoopGoalJudge
  ) {
    this.judge = judge ?? createClaudeGoalJudge()
  }

  async tick(
    automation: Automation,
    loop: AutomationLoop,
    now: number,
    terminals: LoopTerminals
  ): Promise<void> {
    const trigger = loop.trigger
    if (trigger.kind !== 'goal') {
      return
    }
    const tabIds = this.host.resolveTabIds(loop)
    const [watchTab] = tabIds
    const read = watchTab ? await terminals.read(watchTab, loop.state.outputCursor) : null
    if (!read) {
      return
    }
    const id = automation.id
    const judged = trigger.judge === 'agent'
    if (judged) {
      this.transcripts.set(id, appendJudgeTranscript(this.transcripts.get(id) ?? [], read.lines))
    }
    const verdict = judged
      ? loop.state.lastVerdict
      : (readGoalVerdict(read.lines) ?? loop.state.lastVerdict)
    const state: AutomationLoopState = {
      ...loop.state,
      outputCursor: read.cursor,
      lastVerdict: verdict
    }
    const decision = admitGoalStep({
      state,
      verdict,
      now,
      checkEveryMs: trigger.checkEveryMs,
      maxRuns: trigger.maxRuns
    })
    if (decision === 'fire') {
      this.transcripts.set(id, [])
      await this.host.fire(automation, loop, now, loopInstruction(trigger, automation.prompt), {
        ...state,
        lastVerdict: null,
        judgedAt: null
      })
      return
    }
    if (decision === 'retire-met' || decision === 'retire-exhausted') {
      this.transcripts.delete(id)
      this.host.saveState(automation, loop, {
        ...state,
        retiredAt: now,
        lastResult:
          decision === 'retire-met'
            ? judged
              ? 'Goal met (judged by a separate read-only session).'
              : 'Goal met.'
            : `Stopped after ${state.runCount} runs; goal not met.`
      })
      return
    }
    const due = (targetsWorking: boolean): boolean =>
      judgeDue({
        runCount: state.runCount,
        verdict: state.lastVerdict,
        lastFiredAt: state.lastFiredAt,
        judgedAt: state.judgedAt,
        now,
        checkEveryMs: trigger.checkEveryMs,
        targetsWorking,
        judging: this.judging.has(id)
      })
    // Only ask the consoles whether they are working once everything else says "judge".
    if (
      judged &&
      due(false) &&
      due(await anyWorking(terminals, tabIds)) &&
      checkExecutionAdmission('agent-run').allowed
    ) {
      this.host.saveState(automation, loop, { ...state, judgedAt: now })
      this.startJudge(automation, trigger.goal, state.runCount)
      return
    }
    if (
      state.outputCursor !== loop.state.outputCursor ||
      state.lastVerdict !== loop.state.lastVerdict
    ) {
      this.host.saveState(automation, loop, state)
    }
  }

  private startJudge(automation: Automation, goal: string, runCount: number): void {
    this.judging.add(automation.id)
    const transcript = this.transcripts.get(automation.id) ?? []
    void this.judge({ goal, transcript })
      .then((result) => this.saveVerdict(automation.id, runCount, result))
      .catch((error: unknown) => {
        console.error('[board-loops] goal judge failed', automation.id, error)
      })
      .finally(() => {
        this.judging.delete(automation.id)
      })
  }

  /** Writes the verdict onto the latest stored loop, unless a newer run superseded it. */
  private saveVerdict(
    automationId: string,
    runCount: number,
    result: { verdict: 'met' | 'not-met' | null; error: string | null }
  ): void {
    const automation = this.store.listAutomations().find((a) => a.id === automationId)
    const loop = automation ? normalizeAutomationLoop(automation.loop) : null
    if (!automation || !loop || loop.state.runCount !== runCount || loop.state.retiredAt !== null) {
      return
    }
    const state: AutomationLoopState = result.verdict
      ? {
          ...loop.state,
          lastVerdict: result.verdict,
          lastResult:
            result.verdict === 'met'
              ? 'Judge: goal met.'
              : 'Judge: goal not met yet; loop continues.'
        }
      : {
          ...loop.state,
          lastResult: result.error ?? 'Judge gave no clear answer.'
        }
    this.store.updateAutomation(automation.id, { loop: { ...loop, state } })
  }
}
