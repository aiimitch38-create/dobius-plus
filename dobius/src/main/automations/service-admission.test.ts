import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Repo } from '../../shared/types'
import type * as ExecutionGateModule from '../agents/execution-gate'
import { AutomationService } from './service'

const testState = { dir: '', allowed: true }

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

vi.mock('../agents/execution-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionGateModule>()
  return {
    ...actual,
    checkExecutionAdmission: () =>
      testState.allowed
        ? { allowed: true }
        : {
            allowed: false,
            reason: 'paused',
            message: 'Crew is paused. Resume it on the Agents page to allow autonomous runs.'
          }
  }
})

async function createStore() {
  vi.resetModules()
  const { Store, initDataPath } = await import('../persistence')
  initDataPath()
  return new Store()
}

const makeRepo = (overrides: Partial<Repo> = {}): Repo => ({
  id: 'r1',
  path: '/repo',
  displayName: 'test',
  badgeColor: '#fff',
  addedAt: 1,
  ...overrides
})

async function setupDueAutomation() {
  vi.setSystemTime(new Date('2026-05-13T08:59:00'))
  const store = await createStore()
  store.addRepo(makeRepo())
  const automation = store.createAutomation({
    name: 'Morning check',
    prompt: 'Check the repo',
    agentId: 'claude',
    projectId: 'r1',
    workspaceMode: 'existing',
    workspaceId: 'wt1',
    timezone: 'UTC',
    rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    dtstart: new Date('2026-05-12T00:00:00').getTime()
  })
  vi.setSystemTime(new Date('2026-05-13T09:01:00'))
  const send = vi.fn()
  const service = new AutomationService(store, { tickMs: 60_000 })
  service.setWebContents({ isDestroyed: () => false, send } as never)
  return { store, automation, send, service }
}

describe('AutomationService crew admission', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-automations-admission-test-'))
    testState.allowed = true
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('records a paused scheduled run as skipped_unavailable and does not dispatch it', async () => {
    testState.allowed = false
    const { store, automation, send, service } = await setupDueAutomation()

    service.start()
    service.setRendererReady()
    await vi.waitFor(() =>
      expect(store.listAutomationRuns(automation.id)[0]?.status).toBe('skipped_unavailable')
    )
    // A later tick while still paused must not re-fire the same occurrence.
    await vi.advanceTimersByTimeAsync(60_000)
    service.stop()

    expect(send).not.toHaveBeenCalled()
    const runs = store.listAutomationRuns(automation.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      trigger: 'scheduled',
      status: 'skipped_unavailable',
      error: expect.stringContaining('Crew is paused')
    })
    expect(store.listAutomations().find((entry) => entry.id === automation.id)?.nextRunAt).toBe(
      new Date('2026-05-14T09:00:00').getTime()
    )
  })

  it('still dispatches a manual run now while the crew is paused', async () => {
    testState.allowed = false
    const { store, automation, send, service } = await setupDueAutomation()
    service.setRendererReady()
    await vi.waitFor(() =>
      expect(store.listAutomationRuns(automation.id)[0]?.status).toBe('skipped_unavailable')
    )

    const run = await service.runNow(automation.id)

    expect(run).toMatchObject({ trigger: 'manual', status: 'dispatching' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      'automations:dispatchRequested',
      expect.objectContaining({ run: expect.objectContaining({ id: run.id }) })
    )
  })

  it('dispatches scheduled runs unchanged when the crew is not paused', async () => {
    const { store, automation, send, service } = await setupDueAutomation()

    service.start()
    service.setRendererReady()
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith('automations:dispatchRequested', expect.any(Object))
    )
    service.stop()

    expect(store.listAutomationRuns(automation.id)[0]?.status).toBe('dispatching')
  })
})
