import { describe, expect, it } from 'vitest'
import type { AutomationPrecheckResult } from './automations-types'
import {
  attemptSpendUsd,
  buildRetryPrompt,
  decideNextStep,
  DEFAULT_LOOP_MAX_RUNS,
  HARD_MAX_LOOP_RUNS,
  isLocalOnlyToolUse,
  isOutwardBashCommand,
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
    nextBudgetUsd: 1,
    executionAdmitted: true,
    ...overrides
  }
}

function bash(command: string): string {
  return JSON.stringify({ command, description: 'x' })
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

  it('is done when the check passes, even after an outward tool', () => {
    expect(decideNextStep(input({ checkPassed: true, usedOutwardTool: true }))).toMatchObject({
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

  it('marks a failed check after an outward or unknown tool as needs-review', () => {
    expect(decideNextStep(input({ usedOutwardTool: true }))).toMatchObject({
      step: 'final',
      outcome: 'needs-review'
    })
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

describe('isLocalOnlyToolUse', () => {
  it.each(['Read', 'Write', 'Edit', 'Grep', 'Glob', 'TodoWrite', 'NotebookEdit', 'Task', 'Agent'])(
    'treats %s as local',
    (tool) => {
      expect(isLocalOnlyToolUse(tool, '{}')).toBe(true)
    }
  )

  it('treats the read-only dobius tools as local and the posting ones as outward', () => {
    expect(isLocalOnlyToolUse('mcp__dobius__read_knowledge')).toBe(true)
    expect(isLocalOnlyToolUse('mcp__dobius__post_channel_message')).toBe(false)
  })

  it.each([
    'mcp__claude_ai_Gmail__send_message',
    'mcp__playwright__browser_click',
    'WebFetch',
    'SomeNewTool',
    '',
    undefined
  ])('fails closed for the unknown tool %s', (tool) => {
    expect(isLocalOnlyToolUse(tool, '{}')).toBe(false)
  })

  it.each([
    'npm test',
    'git status && git commit -m "fix"',
    'git stash push -m wip',
    'cat ~/.ssh/config',
    'grep -rn "ssh" docs',
    'curl -sSfL https://example.com/file.json',
    'pnpm run typecheck:node'
  ])('treats the Bash command `%s` as local', (command) => {
    expect(isLocalOnlyToolUse('Bash', bash(command))).toBe(true)
  })

  it.each([
    'git push origin main',
    'git -C /repo push',
    'cd /repo && git push --force',
    'gh pr create --fill',
    'gh release create v1',
    'npm publish',
    'pnpm --filter app publish',
    'vercel --prod',
    'netlify deploy',
    'firebase deploy --only hosting',
    'curl -X POST https://api.example.com/pay',
    'curl -sXPOST https://api.example.com',
    'curl https://api.example.com -d @body.json',
    'wget --post-data "a=1" https://example.com',
    'dobius terminal send --terminal t1 --text hi',
    'osascript -e \'tell application "Messages" to send "hi"\'',
    'ssh host uptime',
    'scp file host:/tmp',
    'stripe charges create',
    'TOKEN=abc ssh host',
    'sudo ssh host',
    'echo ok; ssh host',
    'bash -c "ssh host"',
    'echo $(curl --data x https://example.com)'
  ])('treats the Bash command `%s` as outward', (command) => {
    expect(isOutwardBashCommand(command)).toBe(true)
    expect(isLocalOnlyToolUse('Bash', bash(command))).toBe(false)
  })

  it('fails closed when a Bash command cannot be read', () => {
    expect(isLocalOnlyToolUse('Bash')).toBe(false)
    expect(isLocalOnlyToolUse('Bash', 'not json')).toBe(false)
    expect(isLocalOnlyToolUse('Bash', '{"command":42}')).toBe(false)
    expect(isLocalOnlyToolUse('Bash', '{}')).toBe(false)
  })

  it('accepts a Bash progress tick, whose command was judged on its own event', () => {
    expect(isLocalOnlyToolUse('Bash', '12s')).toBe(true)
    expect(isLocalOnlyToolUse('mcp__claude_ai_Gmail__send_message', '12s')).toBe(false)
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
