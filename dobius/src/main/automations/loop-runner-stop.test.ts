import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type * as ExecutionGateModule from '../agents/execution-gate'
import type { AutomationLoop } from '../../shared/automations-types'
import { LOOP_PLACEHOLDER_RRULE, newLoopState } from '../../shared/automation-loops'
import { LoopRunner } from './loop-runner'
import type { LoopTerminals } from './loop-terminals'
import type { StopCheckResult } from './loop-stop-check'

const testState = { dir: '' }

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  Notification: undefined,
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

vi.mock('../agents/execution-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionGateModule>()
  return { ...actual, checkExecutionAdmission: () => ({ allowed: true }) }
})

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

async function setup(loop: Omit<AutomationLoop, 'worktreeId' | 'state'>) {
  vi.resetModules()
  const { Store, initDataPath } = await import('../persistence')
  initDataPath()
  const store = new Store()
  store.addRepo({ id: 'r1', path: '/repo', displayName: 'test', badgeColor: '#fff', addedAt: 1 })
  const created = store.createAutomation({
    name: 'Rescue',
    prompt: 'Fix the build',
    agentId: 'claude',
    projectId: 'r1',
    workspaceMode: 'existing',
    workspaceId: 'wt1',
    timezone: 'UTC',
    rrule: LOOP_PLACEHOLDER_RRULE,
    dtstart: 0
  })
  const automation = store.updateAutomation(created.id, {
    loop: { worktreeId: 'wt1', state: newLoopState(), ...loop }
  })
  const sent: string[] = []
  const working = { value: false }
  const terminals: LoopTerminals = {
    read: async () => ({ lines: [], cursor: '0' }),
    deliver: async (tabId) => {
      sent.push(tabId)
      return 'sent'
    },
    agentWorking: async () => working.value
  }
  const checks: { command: string; worktreeId: string }[] = []
  const results: StopCheckResult[] = []
  const stopCheck = vi.fn(async (command: string, worktreeId: string) => {
    checks.push({ command, worktreeId })
    return results.shift() ?? { exitCode: 1, error: null }
  })
  const notifyFinished = vi.fn()
  const runner = new LoopRunner(store, terminals, vi.fn(), { stopCheck, notifyFinished })
  const loopOf = () => store.listAutomations().find((a) => a.id === automation.id)!
  return { runner, loopOf, sent, working, checks, results, stopCheck, notifyFinished }
}

const IDLE = {
  kind: 'on-idle',
  target: { type: 'tab', tabId: 'tab-a' },
  debounceMs: 1_000
} as const

describe('run-count stop', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-loop-stop-test-'))
  })
  afterEach(() => rmSync(testState.dir, { recursive: true, force: true }))

  it('on-idle: retires after the last allowed run and refuses further fires', async () => {
    const { runner, loopOf, sent } = await setup({ trigger: IDLE, stopAfterRuns: 2 })
    await runner.fireFromRequest(loopOf(), 10_000)
    expect(loopOf().loop?.state.retiredAt).toBeNull()
    await runner.fireFromRequest(loopOf(), 20_000)
    expect(loopOf().loop?.state).toMatchObject({ runCount: 2, retiredAt: 20_000 })
    expect(loopOf().loop?.state.lastResult).toMatch(/Stopped after 2 runs/)
    expect(await runner.fireFromRequest(loopOf(), 30_000)).toBeNull()
    expect(sent).toHaveLength(2)
  })

  it('schedule: stops after N runs', async () => {
    const { runner, loopOf, sent } = await setup({
      trigger: { kind: 'schedule', target: { type: 'tab', tabId: 'tab-a' }, everyMs: 60_000 },
      stopAfterRuns: 1
    })
    const createdAt = loopOf().createdAt
    await runner.tick(createdAt + 60_000)
    await runner.tick(createdAt + 120_000)
    await runner.tick(createdAt + 180_000)
    expect(sent).toHaveLength(1)
    expect(loopOf().loop?.state.retiredAt).toBe(createdAt + 60_000)
  })
})

describe('until-command-passes stop', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-loop-stop-test-'))
  })
  afterEach(() => rmSync(testState.dir, { recursive: true, force: true }))

  it('checks once per run after the agent is done, in the loop worktree; exit 0 retires and notifies', async () => {
    const { runner, loopOf, working, checks, results, notifyFinished } = await setup({
      trigger: IDLE,
      stopCommand: 'pnpm run build'
    })
    await runner.fireFromRequest(loopOf(), 100_000)
    expect(loopOf().loop?.state.stopCheckSince).toBe(100_000)

    await runner.tick(110_000) // under the 30s minimum
    working.value = true
    await runner.tick(140_000) // agent still working
    expect(checks).toEqual([])

    working.value = false
    await runner.tick(141_000)
    await flush()
    expect(checks).toEqual([{ command: 'pnpm run build', worktreeId: 'wt1' }])
    expect(loopOf().loop?.state).toMatchObject({ retiredAt: null, stopCheckSince: null })
    expect(loopOf().loop?.state.lastResult).toMatch(/did not pass \(exit 1\)/)

    // No new run, no new check.
    await runner.tick(200_000)
    await flush()
    expect(checks).toHaveLength(1)

    results.push({ exitCode: 0, error: null })
    await runner.fireFromRequest(loopOf(), 300_000)
    await runner.tick(340_000)
    await flush()
    expect(checks).toHaveLength(2)
    expect(loopOf().loop?.state.retiredAt).not.toBeNull()
    expect(loopOf().loop?.state.lastResult).toMatch(/passed; loop finished/)
    expect(notifyFinished).toHaveBeenCalledWith('Rescue', expect.stringContaining('pnpm run build'))
  })

  it('checks anyway once the maximum wait has passed', async () => {
    const { runner, loopOf, working, checks } = await setup({
      trigger: IDLE,
      stopCommand: 'pnpm test'
    })
    working.value = true
    await runner.fireFromRequest(loopOf(), 0)
    await runner.tick(14 * 60_000)
    expect(checks).toHaveLength(0)
    await runner.tick(15 * 60_000)
    await flush()
    expect(checks).toHaveLength(1)
  })

  it('never runs a destructive or chained command', async () => {
    for (const stopCommand of ['rm -rf dist', 'pnpm test && git push', 'git reset --hard']) {
      const { runner, loopOf, stopCheck } = await setup({ trigger: IDLE, stopCommand })
      await runner.fireFromRequest(loopOf(), 0)
      await runner.tick(60_000)
      await flush()
      expect(stopCheck).not.toHaveBeenCalled()
      expect(loopOf().loop?.state.lastResult).toMatch(/^Stop command not run/)
      expect(loopOf().loop?.state.retiredAt).toBeNull()
    }
  })
})
