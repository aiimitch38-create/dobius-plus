import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type * as ExecutionGateModule from '../agents/execution-gate'
import type { AutomationLoop, AutomationLoopTrigger } from '../../shared/automations-types'
import { LOOP_PLACEHOLDER_RRULE, newLoopState } from '../../shared/automation-loops'
import { LoopRunner } from './loop-runner'
import type { LoopGoalJudge } from './loop-goal-judge'
import type { LoopTerminals } from './loop-terminals'

const testState = { dir: '', allowed: true }

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

vi.mock('../agents/execution-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionGateModule>()
  return {
    ...actual,
    checkExecutionAdmission: () =>
      testState.allowed
        ? { allowed: true }
        : { allowed: false, reason: 'paused', message: 'Crew is paused.' }
  }
})

async function createStore() {
  vi.resetModules()
  const { Store, initDataPath } = await import('../persistence')
  initDataPath()
  const store = new Store()
  store.addRepo({ id: 'r1', path: '/repo', displayName: 'test', badgeColor: '#fff', addedAt: 1 })
  return store
}

function fakeTerminals() {
  const output: Record<string, string[]> = { 'tab-a': [] }
  const sent: { tabId: string; text: string }[] = []
  const working = new Set<string>()
  const terminals: LoopTerminals = {
    read: async (tabId, cursor) => {
      const lines = output[tabId] ?? []
      return cursor === null
        ? { lines: [], cursor: String(lines.length) }
        : { lines: lines.slice(Number(cursor)), cursor: String(lines.length) }
    },
    deliver: async (tabId, text) => {
      sent.push({ tabId, text })
      return 'sent'
    },
    agentWorking: async (tabId) => working.has(tabId)
  }
  return { output, sent, working, terminals }
}

async function setup(
  trigger: AutomationLoopTrigger,
  extra: Partial<AutomationLoop> = {},
  verdicts: ('met' | 'not-met' | null)[] = []
) {
  const store = await createStore()
  const created = store.createAutomation({
    name: 'Loop',
    prompt: 'Make the tests pass',
    agentId: 'claude',
    projectId: 'r1',
    workspaceMode: 'existing',
    workspaceId: 'wt1',
    timezone: 'UTC',
    rrule: LOOP_PLACEHOLDER_RRULE,
    dtstart: 0
  })
  const automation = store.updateAutomation(created.id, {
    loop: { worktreeId: 'wt1', trigger, state: newLoopState(), ...extra }
  })
  const fake = fakeTerminals()
  const judgeCalls: { goal: string; transcript: readonly string[] }[] = []
  const judge = vi.fn<LoopGoalJudge>(async (input) => {
    judgeCalls.push(input)
    const verdict = verdicts.shift() ?? null
    return verdict
      ? { verdict, error: null }
      : { verdict: null, error: 'Judge timed out after 90s.' }
  })
  const runner = new LoopRunner(store, fake.terminals, () => {}, { judge })
  const loopOf = () => store.listAutomations().find((a) => a.id === automation.id)!
  return { store, runner, loopOf, judge, judgeCalls, t0: automation.createdAt, ...fake }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const judgedGoal: AutomationLoopTrigger = {
  kind: 'goal',
  target: { type: 'tab', tabId: 'tab-a' },
  goal: 'All tests pass',
  checkEveryMs: 60_000,
  maxRuns: 3,
  judge: 'agent'
}

describe('LoopRunner: agent-judged goals', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-loop-judge-test-'))
    testState.allowed = true
  })
  afterEach(() => rmSync(testState.dir, { recursive: true, force: true }))

  it('fires the instruction, judges the new output in a separate call, refires on NOT MET and retires on MET', async () => {
    const { runner, loopOf, output, sent, judge, judgeCalls } = await setup(judgedGoal, {}, [
      'not-met',
      'met'
    ])
    await runner.tick(0)
    expect(sent).toEqual([{ tabId: 'tab-a', text: 'Make the tests pass' }])
    expect(sent[0].text).not.toContain('DOBIUS_GOAL')

    output['tab-a'].push('3 tests failed')
    await runner.tick(10_000)
    expect(judge).not.toHaveBeenCalled()

    await runner.tick(35_000)
    await flush()
    expect(judgeCalls).toEqual([{ goal: 'All tests pass', transcript: ['3 tests failed'] }])
    expect(loopOf().loop?.state).toMatchObject({ lastVerdict: 'not-met', judgedAt: 35_000 })
    // The judge only returns a verdict; nothing new reached the console yet.
    expect(sent).toHaveLength(1)

    await runner.tick(61_000)
    expect(sent).toHaveLength(2)
    expect(loopOf().loop?.state).toMatchObject({ runCount: 2, lastVerdict: null })

    output['tab-a'].push('all green')
    await runner.tick(100_000)
    await flush()
    expect(judgeCalls[1].transcript).toEqual(['all green'])
    await runner.tick(105_000)
    expect(loopOf().loop?.state.retiredAt).toBe(105_000)
    expect(loopOf().loop?.state.lastResult).toContain('Goal met')
    expect(sent).toHaveLength(2)
  })

  it('waits while the target agent is still working', async () => {
    const { runner, judge, working } = await setup(judgedGoal)
    await runner.tick(0)
    working.add('tab-a')
    await runner.tick(40_000)
    expect(judge).not.toHaveBeenCalled()
    working.delete('tab-a')
    await runner.tick(45_000)
    expect(judge).toHaveBeenCalledTimes(1)
  })

  it('records a judge failure and retries only after the check interval', async () => {
    const { runner, loopOf, judge, sent } = await setup(judgedGoal, {}, [null])
    await runner.tick(0)
    await runner.tick(40_000)
    await flush()
    expect(loopOf().loop?.state).toMatchObject({
      lastVerdict: null,
      lastResult: 'Judge timed out after 90s.'
    })
    await runner.tick(80_000)
    expect(judge).toHaveBeenCalledTimes(1)
    await runner.tick(100_000)
    expect(judge).toHaveBeenCalledTimes(2)
    expect(sent).toHaveLength(1)
  })

  it('never starts a judge while autonomous runs are paused', async () => {
    const { runner, judge } = await setup(judgedGoal)
    await runner.tick(0)
    testState.allowed = false
    await runner.tick(40_000)
    expect(judge).not.toHaveBeenCalled()
  })
})

describe('LoopRunner: keep running behind other tabs', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-loop-bg-test-'))
    testState.allowed = true
  })
  afterEach(() => rmSync(testState.dir, { recursive: true, force: true }))

  const schedule: AutomationLoopTrigger = {
    kind: 'schedule',
    target: { type: 'tab', tabId: 'tab-a' },
    everyMs: 60_000
  }

  it('a loop with background off waits while its Board is hidden and catches up when shown', async () => {
    const { runner, sent, t0 } = await setup(schedule, { background: false })
    await runner.tick(t0 + 120_000)
    expect(sent).toHaveLength(0)
    runner.setBoardVisible('wt1', 'win-1', true, t0 + 125_000)
    await runner.tick(t0 + 130_000)
    expect(sent).toHaveLength(1)
    // The window's lease lapses without heartbeats.
    await runner.tick(t0 + 300_000)
    expect(sent).toHaveLength(1)
  })

  it('a hidden report from one window does not hide a Board another window still shows', async () => {
    const { runner, sent, t0 } = await setup(schedule, { background: false })
    runner.setBoardVisible('wt1', 'win-1', true, t0 + 100_000)
    runner.setBoardVisible('wt1', 'win-2', true, t0 + 100_000)
    runner.setBoardVisible('wt1', 'win-1', false, t0 + 110_000)
    await runner.tick(t0 + 120_000)
    expect(sent).toHaveLength(1)
  })

  it('legacy schedule loops (no flag) keep running while the Board is hidden', async () => {
    const { runner, sent, t0 } = await setup(schedule)
    await runner.tick(t0 + 60_000)
    expect(sent).toHaveLength(1)
  })

  it('background on-idle loops fire from main once the hidden target goes idle', async () => {
    const { runner, sent, working } = await setup(
      { kind: 'on-idle', target: { type: 'tab', tabId: 'tab-a' }, debounceMs: 5_000 },
      { background: true }
    )
    await runner.tick(1_000)
    working.add('tab-a')
    await runner.tick(6_000)
    working.delete('tab-a')
    await runner.tick(11_000)
    expect(sent).toHaveLength(0)
    await runner.tick(16_000)
    expect(sent).toEqual([{ tabId: 'tab-a', text: 'Make the tests pass' }])
  })

  it('on-idle loops leave idle detection to the Board observer while the Board is visible', async () => {
    const { runner, sent, working } = await setup(
      { kind: 'on-idle', target: { type: 'tab', tabId: 'tab-a' }, debounceMs: 5_000 },
      { background: true }
    )
    runner.setBoardVisible('wt1', 'win-1', true, 0)
    working.add('tab-a')
    await runner.tick(1_000)
    working.delete('tab-a')
    await runner.tick(10_000)
    await runner.tick(20_000)
    expect(sent).toHaveLength(0)
  })
})
