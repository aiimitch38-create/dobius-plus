import { describe, expect, it } from 'vitest'
import type { AutomationPrecheckResult } from './automations-types'
import {
  attemptSpendUsd,
  buildRetryPrompt,
  decideNextStep,
  DEFAULT_LOOP_MAX_RUNS,
  HARD_MAX_LOOP_RUNS,
  loopBudgetCeilingUsd,
  normalizeAgentRunPostcheck,
  normalizeLoopMaxRuns,
  retryBudgetUsd,
  type LoopDecisionInput
} from './agent-run-loop'

function input(overrides: Partial<LoopDecisionInput> = {}): LoopDecisionInput {
  return {
    status: 'success',
    checkPassed: false,
    attempt: 1,
    maxRuns: DEFAULT_LOOP_MAX_RUNS,
    engine: 'claude',
    source: 'manual',
    sessionKey: 'default',
    origin: 'agent-run',
    usedOutwardTool: false,
    changedTooling: false,
    nextBudgetUsd: 1,
    executionAdmitted: true,
    ...overrides
  }
}

function checkResult(overrides: Partial<AutomationPrecheckResult> = {}): AutomationPrecheckResult {
  return {
    command: 'npm test',
    exitCode: 1,
    timedOut: false,
    durationMs: 10,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    error: null,
    startedAt: 1,
    completedAt: 11,
    ...overrides
  }
}

describe('decideNextStep', () => {
  it('asks for the check once a run succeeds', () => {
    expect(decideNextStep(input({ checkPassed: null }))).toEqual({ step: 'check' })
  })

  it('is done when the check passes', () => {
    expect(decideNextStep(input({ checkPassed: true }))).toMatchObject({
      step: 'final',
      outcome: 'verified'
    })
  })

  it('retries a failed check on attempt 1 and blocks on attempt 2', () => {
    expect(decideNextStep(input({ attempt: 1 }))).toEqual({ step: 'retry' })
    expect(decideNextStep(input({ attempt: 2 }))).toMatchObject({ step: 'final', outcome: 'blocked' })
  })

  it('never runs more than the hard ceiling, whatever maxRuns says', () => {
    expect(decideNextStep(input({ attempt: 2, maxRuns: 99 }))).toEqual({ step: 'retry' })
    expect(decideNextStep(input({ attempt: HARD_MAX_LOOP_RUNS, maxRuns: 99 }))).toMatchObject({
      step: 'final',
      outcome: 'blocked'
    })
  })

  it.each<[string, Partial<LoopDecisionInput>]>([
    ['an outward or unknown tool', { usedOutwardTool: true }],
    ['a tooling change', { changedTooling: true }]
  ])('never asks for the check after %s, and never retries', (_label, overrides) => {
    for (const checkPassed of [null, true, false]) {
      expect(decideNextStep(input({ ...overrides, checkPassed }))).toMatchObject({
        step: 'final',
        outcome: 'needs-review'
      })
    }
  })

  it.each<[string, Partial<LoopDecisionInput>]>([
    ['Codex', { engine: 'codex' }],
    ['channel', { source: 'channel' }],
    ['heartbeat', { source: 'heartbeat' }],
    ['Asana', { source: 'asana' }],
    ['iMessage session', { sessionKey: 'imessage' }],
    ['iMessage origin', { origin: 'imessage-command' }],
    ['voice', { spawnedBy: 'voice-conductor' }],
    ['no budget', { nextBudgetUsd: 0.2 }],
    ['unknown budget', { nextBudgetUsd: Number.NaN }],
    ['paused crew', { executionAdmitted: false }]
  ])('does not retry a %s run', (_label, overrides) => {
    expect(decideNextStep(input(overrides))).toMatchObject({ step: 'final', outcome: 'blocked' })
  })

  it('does nothing for a cancelled run and never checks an errored one', () => {
    expect(decideNextStep(input({ status: 'cancelled', checkPassed: null }))).toEqual({ step: 'none' })
    expect(decideNextStep(input({ status: 'error', checkPassed: null }))).toMatchObject({
      step: 'final',
      outcome: 'blocked'
    })
  })
})

describe('loop budget', () => {
  it('shares 1.5 times the run cap across attempts', () => {
    expect(loopBudgetCeilingUsd(2)).toBe(3)
    expect(retryBudgetUsd({ budgetCeilingUsd: 3, spentUsd: 1.8, runBudgetUsd: 2 })).toBeCloseTo(1.2)
  })

  it('never gives one retry more than a single run cap', () => {
    expect(retryBudgetUsd({ budgetCeilingUsd: 3, spentUsd: 0.1, runBudgetUsd: 2 })).toBe(2)
  })

  it('gives nothing when the ceiling is spent or unknown', () => {
    expect(retryBudgetUsd({ budgetCeilingUsd: 3, spentUsd: 3, runBudgetUsd: 2 })).toBe(0)
    expect(retryBudgetUsd({ budgetCeilingUsd: Number.NaN, spentUsd: 0, runBudgetUsd: 2 })).toBe(0)
    expect(loopBudgetCeilingUsd(Number.NaN)).toBe(0)
  })

  it('counts a run with no reported cost as its whole cap', () => {
    expect(attemptSpendUsd(0.4, 2)).toBe(0.4)
    expect(attemptSpendUsd(undefined, 2)).toBe(2)
  })

  it('clamps the run count to the hard ceiling', () => {
    expect(normalizeLoopMaxRuns(undefined)).toBe(2)
    expect(normalizeLoopMaxRuns(10)).toBe(3)
    expect(normalizeLoopMaxRuns(0)).toBe(1)
  })
})

describe('normalizeAgentRunPostcheck', () => {
  it('trims the command and clamps the timeout', () => {
    expect(normalizeAgentRunPostcheck({ command: '  npm test  ', timeoutSeconds: 9000 })).toEqual({
      command: 'npm test',
      timeoutSeconds: 600
    })
    expect(normalizeAgentRunPostcheck({ command: 'npm test' })).toEqual({
      command: 'npm test',
      timeoutSeconds: 60
    })
  })

  it('rejects an empty or oversized command', () => {
    expect(normalizeAgentRunPostcheck({ command: '   ' })).toBeNull()
    expect(normalizeAgentRunPostcheck({ command: 'x'.repeat(501) })).toBeNull()
    expect(normalizeAgentRunPostcheck(undefined)).toBeNull()
  })
})

describe('buildRetryPrompt', () => {
  it('carries the command, the exit code and the tail of the output', () => {
    const prompt = buildRetryPrompt(
      checkResult({ stdout: `${'a'.repeat(5000)}END`, stderr: 'boom' })
    )
    expect(prompt).toContain('Command: npm test')
    expect(prompt).toContain('Result: exit 1')
    expect(prompt).toContain('boom')
    expect(prompt).toContain('Do not send, post, push, deploy or pay.')
    expect(prompt.length).toBeLessThan(4400)
  })

  it('says so when the check timed out', () => {
    expect(buildRetryPrompt(checkResult({ timedOut: true, exitCode: null }))).toContain(
      'Result: timed out'
    )
  })
})
