import type { AutomationPrecheck, AutomationPrecheckResult } from './automations-types'

export const DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS = 60
export const MAX_AUTOMATION_PRECHECK_TIMEOUT_SECONDS = 600
export const MAX_AUTOMATION_PRECHECK_OUTPUT_CHARS = 4000

export function normalizeAutomationPrecheckTimeoutSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_AUTOMATION_PRECHECK_TIMEOUT_SECONDS
  }
  return Math.min(MAX_AUTOMATION_PRECHECK_TIMEOUT_SECONDS, Math.max(1, Math.floor(value)))
}

export function normalizeAutomationPrecheck(
  precheck: AutomationPrecheck | null | undefined
): AutomationPrecheck | null {
  const command = typeof precheck?.command === 'string' ? precheck.command.trim() : ''
  if (!command) {
    return null
  }
  return {
    command,
    timeoutSeconds: normalizeAutomationPrecheckTimeoutSeconds(precheck?.timeoutSeconds)
  }
}

export function formatAutomationPrecheckTimeout(seconds: number): string {
  return `${seconds}s`
}

export function didAutomationPrecheckPass(
  result: AutomationPrecheckResult | null | undefined
): boolean {
  return Boolean(result && !result.timedOut && !result.error && result.exitCode === 0)
}

export function formatAutomationPrecheckFailure(result: AutomationPrecheckResult): string {
  if (result.timedOut) {
    return `Precheck timed out after ${formatAutomationPrecheckTimeout(
      Math.max(1, Math.round(result.durationMs / 1000))
    )}.`
  }
  if (result.error) {
    return `Precheck failed: ${result.error}`
  }
  return `Precheck exited with code ${result.exitCode ?? 'unknown'}.`
}

// A precheck that could not run because its target was unavailable.
export function buildUnavailablePrecheckResult(
  command: string,
  error: string,
  now: number = Date.now()
): AutomationPrecheckResult {
  return {
    command,
    exitCode: null,
    timedOut: false,
    durationMs: 0,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    error,
    startedAt: now,
    completedAt: now
  }
}
