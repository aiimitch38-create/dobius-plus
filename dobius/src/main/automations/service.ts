import type { WebContents } from 'electron'
import type { Store } from '../persistence'
import type {
  Automation,
  AutomationDispatchRequest,
  AutomationDispatchResult,
  AutomationPrecheckResult,
  AutomationRun
} from '../../shared/automations-types'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import { runAutomationPrecheck } from './precheck-runner'
import { resolveAutomationRunTarget, type AutomationRunTargetResult } from './run-target-resolution'
import type { HeadlessAutomationDispatcher } from './headless-dispatch'
import { createAutomationDispatchToken } from './dispatch-tokens'
import {
  buildUnavailablePrecheckResult,
  didAutomationPrecheckPass,
  formatAutomationPrecheckFailure
} from '../../shared/automation-precheck'
import {
  finalizeAutomationRunResult,
  markInterruptedAutomationRuns,
  recordAutomationEvaluationFailure,
  reportAutomationBackgroundFailure
} from './run-lifecycle'
import {
  checkExecutionAdmission,
  ExecutionBlockedError,
  isExecutionBlockedError
} from '../agents/execution-gate'

const DEFAULT_TICK_MS = 60 * 1000

export class AutomationService {
  private readonly store: Store
  private readonly tickMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private webContents: WebContents | null = null
  private rendererReady = false
  private evaluating = false
  private readonly claudeUsage: ClaudeUsageStore | null
  private readonly codexUsage: CodexUsageStore | null
  private readonly allowRemoteHostScheduling: boolean
  private readonly headlessDispatcher: HeadlessAutomationDispatcher | null

  constructor(
    store: Store,
    opts: {
      tickMs?: number
      claudeUsage?: ClaudeUsageStore
      codexUsage?: CodexUsageStore
      allowRemoteHostScheduling?: boolean
      headlessDispatcher?: HeadlessAutomationDispatcher
    } = {}
  ) {
    this.store = store
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS
    this.claudeUsage = opts.claudeUsage ?? null
    this.codexUsage = opts.codexUsage ?? null
    this.allowRemoteHostScheduling = opts.allowRemoteHostScheduling ?? false
    this.headlessDispatcher = opts.headlessDispatcher ?? null
    // Why: constructed once per process, before any dispatch, so every
    // 'dispatching' run here was left by a previous process.
    markInterruptedAutomationRuns(store)
  }

  setWebContents(webContents: WebContents | null): void {
    this.webContents = webContents
    this.rendererReady = false
  }

  setRendererReady(): void {
    this.rendererReady = true
    void this.evaluateDueRuns()
  }

  start(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => {
      void this.evaluateDueRuns()
    }, this.tickMs)
    // Why: headless serve never gets a renderer-ready IPC, but due runs still
    // need the same startup catch-up pass desktop gets after renderer attach.
    if (this.rendererReady || this.headlessDispatcher) {
      void this.evaluateDueRuns()
    }
  }

  stop(): void {
    if (!this.timer) {
      return
    }
    clearInterval(this.timer)
    this.timer = null
  }

  /**
   * `humanTrigger` is true only for the desktop UI's IPC. Why: RPC/CLI callers
   * can be any local process (including an agent), so their runNow honors
   * "Pause crew" like a scheduled run.
   */
  async runNow(automationId: string, humanTrigger = false): Promise<AutomationRun> {
    const automation = this.store.listAutomations().find((entry) => entry.id === automationId)
    if (!automation) {
      throw new Error('Automation not found.')
    }
    const run = this.store.createAutomationRun(automation, Date.now(), 'manual')
    return await this.requestDispatch(automation, run, !humanTrigger)
  }

  async runPrecheck(automationId: string, runId: string): Promise<AutomationPrecheckResult | null> {
    const automation = this.store.listAutomations().find((entry) => entry.id === automationId)
    if (!automation) {
      throw new Error('Automation not found.')
    }
    const run = this.store.listAutomationRuns(automationId).find((entry) => entry.id === runId)
    if (!run) {
      throw new Error('Automation run not found.')
    }
    if (run.trigger !== 'scheduled' || !automation.precheck) {
      return null
    }
    const target = resolveAutomationRunTarget(this.store, automation, {
      allowRemoteHostScheduling: this.allowRemoteHostScheduling
    })
    if (!target.ok) {
      return buildUnavailablePrecheckResult(automation.precheck.command, target.error)
    }
    return await runAutomationPrecheck({
      precheck: automation.precheck,
      target:
        automation.executionTargetType === 'ssh'
          ? { type: 'ssh', cwd: target.cwd, connectionId: automation.executionTargetId }
          : { type: 'local', cwd: target.cwd }
    })
  }

  async markDispatchResult(result: AutomationDispatchResult): Promise<AutomationRun> {
    return await finalizeAutomationRunResult(
      { store: this.store, claudeUsage: this.claudeUsage, codexUsage: this.codexUsage },
      result
    )
  }

  private async evaluateDueRuns(): Promise<void> {
    if (this.evaluating) {
      return
    }
    this.evaluating = true
    try {
      const now = Date.now()
      for (const automation of this.store.listAutomations()) {
        if (!automation.enabled || automation.nextRunAt > now) {
          continue
        }
        try {
          await this.evaluateAutomation(automation, now)
        } catch (error) {
          recordAutomationEvaluationFailure(this.store, automation, now, error)
        }
      }
    } catch (error) {
      reportAutomationBackgroundFailure('scheduler tick failed', error)
    } finally {
      this.evaluating = false
    }
  }

  private async evaluateAutomation(automation: Automation, now: number): Promise<void> {
    const scheduledFor = this.store.getLatestAutomationOccurrence(automation, now)
    if (scheduledFor === null) {
      this.store.advanceAutomationNextRun(automation.id, now)
      return
    }
    const run = this.store.createAutomationRun(automation, scheduledFor)
    // Why: createAutomationRun returns the existing run for this occurrence. If
    // it already left 'pending' (a crash before nextRunAt advanced), it was
    // already launched or closed and must not be dispatched again.
    if (run.status !== 'pending') {
      this.store.advanceAutomationNextRun(automation.id, now)
      return
    }
    const graceMs = automation.missedRunGraceMinutes * 60 * 1000
    const missed = now - scheduledFor > graceMs
    // Why: scheduled runs are autonomous and must honor "Pause crew" (manual runNow
    // stays allowed). Advancing nextRunAt keeps a paused tick from re-firing.
    const admission = missed ? null : checkExecutionAdmission('agent-run')
    if (missed || !admission?.allowed) {
      this.store.updateAutomationRun({
        runId: run.id,
        status: missed ? 'skipped_missed' : 'skipped_unavailable',
        workspaceId: automation.workspaceId,
        error:
          admission?.allowed === false
            ? admission.message
            : 'Dobius was unavailable during the missed-run grace window.'
      })
      this.store.advanceAutomationNextRun(automation.id, now)
      return
    }

    await this.requestDispatch(automation, run, true)
    this.store.advanceAutomationNextRun(automation.id, now)
  }

  private async requestDispatch(
    automation: Automation,
    run: AutomationRun,
    honorExecutionGate: boolean
  ): Promise<AutomationRun> {
    const target = resolveAutomationRunTarget(this.store, automation, {
      allowRemoteHostScheduling: this.allowRemoteHostScheduling
    })
    // Why: re-checked at launch; Pause crew can be turned on after the scheduler's check.
    const admission = honorExecutionGate ? checkExecutionAdmission('agent-run') : null
    if (!target.ok || admission?.allowed === false) {
      return this.store.updateAutomationRun({
        runId: run.id,
        status: 'skipped_unavailable',
        workspaceId: automation.workspaceId,
        error: admission?.allowed === false ? admission.message : target.ok ? null : target.error
      })
    }
    const webContents = this.webContents
    if (!webContents || webContents.isDestroyed() || !this.rendererReady) {
      if (this.headlessDispatcher) {
        return await this.requestHeadlessDispatch(automation, run, target, honorExecutionGate)
      }
      return this.store.updateAutomationRun({
        runId: run.id,
        status: 'skipped_unavailable',
        workspaceId: automation.workspaceId,
        error: 'No Dobius window was available to launch the automation.'
      })
    }
    const updated = this.store.updateAutomationRun({
      runId: run.id,
      status: 'dispatching',
      workspaceId: automation.workspaceId,
      error: null
    })
    const payload: AutomationDispatchRequest = {
      automation,
      run: updated,
      dispatchToken: createAutomationDispatchToken(automation.id, updated.id),
      honorExecutionGate
    }
    webContents.send('automations:dispatchRequested', payload)
    return updated
  }

  private async requestHeadlessDispatch(
    automation: Automation,
    run: AutomationRun,
    target: Extract<AutomationRunTargetResult, { ok: true }>,
    honorExecutionGate: boolean
  ): Promise<AutomationRun> {
    const precheckResult =
      run.trigger === 'scheduled' && automation.precheck
        ? await this.runPrecheck(automation.id, run.id)
        : null
    if (precheckResult && !didAutomationPrecheckPass(precheckResult)) {
      return this.store.updateAutomationRun({
        runId: run.id,
        status: 'skipped_precheck',
        workspaceId: automation.workspaceId,
        precheckResult,
        error: formatAutomationPrecheckFailure(precheckResult)
      })
    }
    try {
      // Why: the precheck await above gives Pause crew time to turn on.
      const admission = honorExecutionGate ? checkExecutionAdmission('agent-run') : null
      if (admission?.allowed === false) {
        throw new ExecutionBlockedError('agent-run', admission.reason, admission.message)
      }
      // Why: persist the launch intent first; a crash mid-launch then leaves
      // 'dispatching', which startup closes as interrupted instead of re-running.
      const dispatching = this.store.updateAutomationRun({ runId: run.id, status: 'dispatching' })
      const launch = await this.headlessDispatcher!({ automation, run: dispatching, target })
      const launchRunTarget = {
        workspaceId: launch.workspaceId,
        workspaceDisplayName: launch.workspaceDisplayName ?? null,
        terminalSessionId: launch.terminalSessionId,
        terminalPaneKey: launch.terminalPaneKey ?? null,
        terminalPtyId: launch.terminalPtyId ?? null
      }
      const updated = this.store.updateAutomationRun({
        runId: run.id,
        status: 'dispatched',
        ...launchRunTarget,
        error: null
      })
      if (launch.completion) {
        void launch.completion
          .then((completion) =>
            this.markDispatchResult({
              runId: run.id,
              status: completion.status,
              ...launchRunTarget,
              precheckResult,
              outputSnapshot: completion.outputSnapshot ?? null,
              error: completion.error ?? null
            })
          )
          .catch((error) =>
            this.markDispatchResult({
              runId: run.id,
              status: 'dispatch_failed',
              ...launchRunTarget,
              error: error instanceof Error ? error.message : String(error)
            })
          )
          .catch((error) =>
            reportAutomationBackgroundFailure(`could not record the result of run ${run.id}`, error)
          )
      }
      return updated
    } catch (error) {
      return this.store.updateAutomationRun({
        runId: run.id,
        status: isExecutionBlockedError(error) ? 'skipped_unavailable' : 'dispatch_failed',
        workspaceId: automation.workspaceId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
