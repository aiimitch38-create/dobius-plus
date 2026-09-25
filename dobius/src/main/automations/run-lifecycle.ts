import type { Store } from '../persistence'
import type {
  Automation,
  AutomationDispatchResult,
  AutomationRun
} from '../../shared/automations-types'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import { clearAutomationDispatchTokens } from './dispatch-tokens'
import { isFinalRunStatus } from './run-final-status'
import { deliverAutomationRunNotification } from './run-notification-delivery'
import { collectAutomationRunUsage } from './run-usage-collection'

export const INTERRUPTED_DISPATCH_ERROR =
  'Dobius stopped before this run confirmed its launch. The agent may or may not have started; check the workspace before running it again.'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function reportAutomationBackgroundFailure(context: string, error: unknown): void {
  console.error(`[automations] ${context}: ${describeError(error)}`)
}

// Why: completion can be signalled twice (renderer effect re-fire, headless
// then/catch). The first final result claims the run synchronously, before the
// usage await, so a second signal cannot notify or collect usage again or
// overwrite the recorded outcome. Re-collecting would also advance the
// attribution window and could rewrite a 'known' usage as unavailable.
export async function finalizeAutomationRunResult(
  deps: {
    store: Store
    claudeUsage: ClaudeUsageStore | null
    codexUsage: CodexUsageStore | null
  },
  result: AutomationDispatchResult
): Promise<AutomationRun> {
  const { store } = deps
  const current = store.listAutomationRuns().find((entry) => entry.id === result.runId)
  if (current && isFinalRunStatus(current.status)) {
    clearAutomationDispatchTokens(current.automationId, current.id)
    return current
  }
  const run = store.updateAutomationRun(result)
  clearAutomationDispatchTokens(run.automationId, run.id)
  if (!isFinalRunStatus(run.status) || run.usage) {
    return run
  }
  const usage = await collectAutomationRunUsage({
    automation: store.listAutomations().find((entry) => entry.id === run.automationId),
    run,
    claudeUsage: deps.claudeUsage,
    codexUsage: deps.codexUsage
  })
  deliverAutomationRunNotification(store, run)
  return store.updateAutomationRun({
    runId: run.id,
    status: run.status,
    workspaceId: run.workspaceId,
    terminalSessionId: run.terminalSessionId,
    usage,
    error: run.error
  })
}

// Why: a 'dispatching' run is owned by a renderer or headless launch and a
// dispatch token that live only in memory. After a restart nothing can confirm
// or finish that launch, and re-dispatching it could start the agent twice, so
// the run is closed as interrupted and left for the user to re-run.
export function markInterruptedAutomationRuns(store: Store): AutomationRun[] {
  return store
    .listAutomationRuns()
    .filter((run) => run.status === 'dispatching')
    .map((run) =>
      store.updateAutomationRun({
        runId: run.id,
        status: 'dispatch_failed',
        error: INTERRUPTED_DISPATCH_ERROR
      })
    )
}

// Why: a scheduled evaluation that throws must not leave its run 'pending'
// (re-picked every tick) or stop the automations after it in the loop.
export function recordAutomationEvaluationFailure(
  store: Store,
  automation: Automation,
  now: number,
  error: unknown
): void {
  reportAutomationBackgroundFailure(`scheduled run of automation ${automation.id} failed`, error)
  try {
    const scheduledFor = store.getLatestAutomationOccurrence(automation, now)
    const run = store
      .listAutomationRuns(automation.id)
      .find((entry) => entry.scheduledFor === scheduledFor)
    if (run && (run.status === 'pending' || run.status === 'dispatching')) {
      store.updateAutomationRun({
        runId: run.id,
        status: 'dispatch_failed',
        error: `Scheduler error: ${describeError(error)}`
      })
    }
    store.advanceAutomationNextRun(automation.id, now)
  } catch (recordError) {
    reportAutomationBackgroundFailure(
      `could not record the failed run of automation ${automation.id}`,
      recordError
    )
  }
}
