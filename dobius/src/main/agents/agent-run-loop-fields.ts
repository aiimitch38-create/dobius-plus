import type { AgentRun } from '../../shared/agents'
import type { AutomationPrecheckResult } from '../../shared/automations-types'

type LoopFields = Pick<AgentRun, 'attempt' | 'rootRunId' | 'postcheck' | 'outcome' | 'loopCostUsd'>

function sanitizePostcheck(raw: unknown): AutomationPrecheckResult | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined
  }
  const check = raw as Partial<Record<keyof AutomationPrecheckResult, unknown>>
  if (typeof check.command !== 'string' || typeof check.startedAt !== 'number') {
    return undefined
  }
  return {
    command: check.command,
    exitCode: typeof check.exitCode === 'number' ? check.exitCode : null,
    timedOut: check.timedOut === true,
    durationMs: typeof check.durationMs === 'number' ? check.durationMs : 0,
    stdout: typeof check.stdout === 'string' ? check.stdout : '',
    stderr: typeof check.stderr === 'string' ? check.stderr : '',
    stdoutTruncated: check.stdoutTruncated === true,
    stderrTruncated: check.stderrTruncated === true,
    error: typeof check.error === 'string' ? check.error : null,
    startedAt: check.startedAt,
    completedAt: typeof check.completedAt === 'number' ? check.completedAt : check.startedAt
  }
}

/**
 * The run-loop fields of a persisted run. Best-effort like permission denials:
 * a malformed one is dropped, never the run or the file.
 */
export function sanitizeRunLoopFields(record: Partial<Record<keyof AgentRun, unknown>>): LoopFields {
  const fields: LoopFields = {}
  if (typeof record.attempt === 'number' && Number.isInteger(record.attempt) && record.attempt > 0) {
    fields.attempt = record.attempt
  }
  if (typeof record.rootRunId === 'string' && record.rootRunId) {
    fields.rootRunId = record.rootRunId
  }
  const postcheck = sanitizePostcheck(record.postcheck)
  if (postcheck) {
    fields.postcheck = postcheck
  }
  if (
    record.outcome === 'verified' ||
    record.outcome === 'blocked' ||
    record.outcome === 'needs-review'
  ) {
    fields.outcome = record.outcome
  }
  if (typeof record.loopCostUsd === 'number' && Number.isFinite(record.loopCostUsd)) {
    fields.loopCostUsd = record.loopCostUsd
  }
  return fields
}
