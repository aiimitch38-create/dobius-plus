import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Repo } from '../../shared/types'
import type { AutomationPrecheckResult } from '../../shared/automations-types'
import type * as ExecutionGateModule from '../agents/execution-gate'
import { AutomationService } from './service'
import { INTERRUPTED_DISPATCH_ERROR } from './run-lifecycle'

const testState = vi.hoisted(() => ({ dir: '', events: [] as string[] }))
const runAutomationPrecheckMock = vi.hoisted(() => vi.fn())
const deliverNotificationMock = vi.hoisted(() => vi.fn())

vi.mock('./precheck-runner', () => ({
  runAutomationPrecheck: runAutomationPrecheckMock
}))

vi.mock('./run-notification-delivery', () => ({
  deliverAutomationRunNotification: deliverNotificationMock
}))

vi.mock('../agents/execution-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionGateModule>()
  return {
    ...actual,
    checkExecutionAdmission: () => {
      testState.events.push('admission')
      return { allowed: true }
    }
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'),
    decryptString: (ciphertext: Buffer) => ciphertext.toString('utf-8').slice('encrypted:'.length)
  }
}))

async function createStore() {
  vi.resetModules()
  const { Store, initDataPath } = await import('../persistence')
  initDataPath()
  return new Store()
}

type TestStore = Awaited<ReturnType<typeof createStore>>

const makeRepo = (overrides: Partial<Repo> = {}): Repo => ({
  id: 'r1',
  path: '/repo',
  displayName: 'test',
  badgeColor: '#fff',
  addedAt: 1,
  ...overrides
})

function createDueAutomation(
  store: TestStore,
  name: string,
  precheck?: { command: string; timeoutSeconds: number }
) {
  return store.createAutomation({
    name,
    prompt: 'Check the repo',
    ...(precheck ? { precheck } : {}),
    agentId: 'claude',
    projectId: 'r1',
    workspaceMode: 'existing',
    workspaceId: 'wt1',
    timezone: 'UTC',
    rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    dtstart: new Date('2026-05-12T00:00:00').getTime()
  })
}

const passingPrecheck = (): AutomationPrecheckResult => ({
  command: 'true',
  exitCode: 0,
  timedOut: false,
  durationMs: 1,
  stdout: '',
  stderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
  error: null,
  startedAt: Date.now(),
  completedAt: Date.now()
})

const knownUsage = () => ({
  status: 'known' as const,
  provider: 'claude' as const,
  model: 'claude-sonnet-4-6',
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningOutputTokens: null,
  totalTokens: 150,
  estimatedCostUsd: 0.001,
  estimatedCostSource: 'api_equivalent' as const,
  providerSessionId: 'provider-session-1',
  attribution: 'provider_session_time_window' as const,
  collectedAt: Date.now(),
  unavailableReason: null,
  unavailableMessage: null
})

describe('AutomationService run lifecycle', () => {
  const unhandled = vi.fn()

  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-automations-lifecycle-test-'))
    testState.events = []
    runAutomationPrecheckMock.mockReset()
    deliverNotificationMock.mockReset()
    unhandled.mockReset()
    process.on('unhandledRejection', unhandled)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-13T08:59:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    process.off('unhandledRejection', unhandled)
    rmSync(testState.dir, { recursive: true, force: true })
  })

  async function createDispatchedRun() {
    const store = await createStore()
    store.addRepo(makeRepo())
    const automation = createDueAutomation(store, 'Costed check')
    const run = store.createAutomationRun(automation, Date.now(), 'manual')
    store.updateAutomationRun({
      runId: run.id,
      status: 'dispatched',
      workspaceId: 'wt1',
      terminalSessionId: 'tab-1',
      error: null
    })
    return { store, automation, run }
  }

  // #68
  it('two simultaneous completion signals give one usage record and one notification', async () => {
    const { store, run } = await createDispatchedRun()
    let releaseUsage: () => void = () => {}
    const usage = knownUsage()
    const getAutomationRunUsage = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseUsage = () => resolve(usage)
        })
    )
    const service = new AutomationService(store, {
      claudeUsage: { getAutomationRunUsage } as never
    })

    const first = service.markDispatchResult({ runId: run.id, status: 'completed', error: null })
    const second = service.markDispatchResult({
      runId: run.id,
      status: 'dispatch_failed',
      error: 'late duplicate signal'
    })
    await vi.waitFor(() => expect(getAutomationRunUsage).toHaveBeenCalled())
    releaseUsage()
    await Promise.all([first, second])

    expect(getAutomationRunUsage).toHaveBeenCalledTimes(1)
    expect(deliverNotificationMock).toHaveBeenCalledTimes(1)
    expect(store.listAutomationRuns()[0]).toMatchObject({
      status: 'completed',
      error: null,
      usage
    })
  })

  // #68: a claimed run must still finish when the usage scan throws.
  it('records a failed usage scan as unavailable and still notifies once', async () => {
    const { store, run } = await createDispatchedRun()
    const getAutomationRunUsage = vi.fn().mockRejectedValue(new Error('scan exploded'))
    const service = new AutomationService(store, {
      claudeUsage: { getAutomationRunUsage } as never
    })

    const updated = await service.markDispatchResult({
      runId: run.id,
      status: 'completed',
      error: null
    })

    expect(updated.usage).toMatchObject({
      status: 'unavailable',
      unavailableReason: 'scan_failed',
      unavailableMessage: expect.stringContaining('scan exploded')
    })
    expect(deliverNotificationMock).toHaveBeenCalledTimes(1)
  })

  // #69
  it('startup closes a run left dispatching as interrupted and does not re-dispatch it', async () => {
    const store = await createStore()
    store.addRepo(makeRepo())
    const automation = createDueAutomation(store, 'Morning check')
    vi.setSystemTime(new Date('2026-05-13T09:01:00'))
    // Previous process: dispatch intent persisted, then it quit before
    // nextRunAt advanced or the renderer confirmed the launch.
    const scheduledFor = new Date('2026-05-13T09:00:00').getTime()
    const run = store.createAutomationRun(automation, scheduledFor)
    store.updateAutomationRun({ runId: run.id, status: 'dispatching', error: null })

    const send = vi.fn()
    const service = new AutomationService(store, { tickMs: 60_000 })
    expect(store.listAutomationRuns(automation.id)[0]).toMatchObject({
      id: run.id,
      status: 'dispatch_failed',
      error: INTERRUPTED_DISPATCH_ERROR
    })

    service.setWebContents({ isDestroyed: () => false, send } as never)
    service.start()
    service.setRendererReady()
    await vi.waitFor(() =>
      expect(store.listAutomations()[0]?.nextRunAt).toBe(new Date('2026-05-14T09:00:00').getTime())
    )
    service.stop()

    expect(send).not.toHaveBeenCalled()
    expect(store.listAutomationRuns(automation.id)).toHaveLength(1)
    expect(store.listAutomationRuns(automation.id)[0]?.status).toBe('dispatch_failed')
  })

  // #69: the headless launch intent is on disk before the launch starts.
  it('persists dispatching before the headless dispatcher runs, after the last admission check', async () => {
    const store = await createStore()
    store.addRepo(makeRepo())
    const automation = createDueAutomation(store, 'Morning check', {
      command: 'true',
      timeoutSeconds: 30
    })
    vi.setSystemTime(new Date('2026-05-13T09:01:00'))
    runAutomationPrecheckMock.mockImplementation(async () => {
      testState.events.push('precheck')
      return passingPrecheck()
    })
    const statusAtLaunch: string[] = []
    const headlessDispatcher = vi.fn(async ({ run }: { run: { id: string; status: string } }) => {
      testState.events.push('dispatch')
      statusAtLaunch.push(
        run.status,
        store.listAutomationRuns().find((entry) => entry.id === run.id)?.status ?? 'missing'
      )
      return { workspaceId: 'wt1', terminalSessionId: 'tab-1' }
    })
    const service = new AutomationService(store, { tickMs: 60_000, headlessDispatcher })

    service.start()
    await vi.waitFor(() => expect(headlessDispatcher).toHaveBeenCalledTimes(1))
    service.stop()

    expect(statusAtLaunch).toEqual(['dispatching', 'dispatching'])
    expect(testState.events.slice(-3)).toEqual(['precheck', 'admission', 'dispatch'])
    await vi.waitFor(() =>
      expect(store.listAutomationRuns(automation.id)[0]?.status).toBe('dispatched')
    )
  })

  // #71
  it('a rejected scheduled evaluation is recorded and does not stop later automations', async () => {
    const store = await createStore()
    store.addRepo(makeRepo())
    const broken = createDueAutomation(store, 'Alpha check', {
      command: 'true',
      timeoutSeconds: 30
    })
    const healthy = createDueAutomation(store, 'Beta check')
    vi.setSystemTime(new Date('2026-05-13T09:01:00'))
    runAutomationPrecheckMock.mockRejectedValue(new Error('precheck host vanished'))
    const headlessDispatcher = vi.fn().mockResolvedValue({
      workspaceId: 'wt1',
      terminalSessionId: 'tab-1'
    })
    const service = new AutomationService(store, { tickMs: 60_000, headlessDispatcher })

    service.start()
    await vi.waitFor(() => expect(headlessDispatcher).toHaveBeenCalledTimes(1))
    service.stop()
    await Promise.resolve()

    expect(unhandled).not.toHaveBeenCalled()
    expect(store.listAutomationRuns(broken.id)[0]).toMatchObject({
      status: 'dispatch_failed',
      error: expect.stringContaining('precheck host vanished')
    })
    const nextDay = new Date('2026-05-14T09:00:00').getTime()
    expect(store.listAutomations().find((entry) => entry.id === broken.id)?.nextRunAt).toBe(nextDay)
    expect(store.listAutomationRuns(healthy.id)[0]?.status).toBe('dispatched')
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(`scheduled run of automation ${broken.id} failed`)
    )
  })

  // #71: completion arriving after its run is gone must not become an unhandled rejection.
  it('a headless completion for a deleted automation is logged, not an unhandled rejection', async () => {
    const store = await createStore()
    store.addRepo(makeRepo())
    const automation = createDueAutomation(store, 'Short lived')
    let finish: () => void = () => {}
    const completion = new Promise<{ status: 'completed' }>((resolve) => {
      finish = () => resolve({ status: 'completed' })
    })
    const headlessDispatcher = vi.fn().mockResolvedValue({
      workspaceId: 'wt1',
      terminalSessionId: 'tab-1',
      completion
    })
    const service = new AutomationService(store, { headlessDispatcher })

    const run = await service.runNow(automation.id, true)
    expect(run.status).toBe('dispatched')
    store.deleteAutomation(automation.id)
    finish()

    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(`could not record the result of run ${run.id}`)
      )
    )
    vi.useRealTimers()
    await new Promise((r) => {
      setTimeout(r, 10)
    })
    expect(unhandled).not.toHaveBeenCalled()
  })
})
