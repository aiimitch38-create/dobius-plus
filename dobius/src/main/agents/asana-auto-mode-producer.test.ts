import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AsanaTask } from '../../shared/asana'

// The real dispatch ledger in a throwaway userData dir; everything that would
// start a run, touch Asana or the briefing store is a fake.
const mocks = vi.hoisted(() => ({
  userDataDir: '',
  triageAgentId: null as string | null,
  startAgentRun: vi.fn(),
  appendBriefingItem: vi.fn()
}))

vi.mock('electron', () => ({ app: { getPath: () => mocks.userDataDir } }))
vi.mock('../asana/asana-config', () => ({
  getAsanaConfig: () => ({ autoMode: { triageAgentId: mocks.triageAgentId } })
}))
vi.mock('../asana/asana-queue-service', () => ({ refreshAsanaTasks: vi.fn() }))
vi.mock('../asana/asana-token-store', () => ({ hasAsanaToken: () => true }))
vi.mock('./agent-briefing-store', () => ({ appendBriefingItem: mocks.appendBriefingItem }))
vi.mock('./agent-notification-store', () => ({ appendAgentNotification: vi.fn() }))
vi.mock('./agents-config-store', () => ({ getAgentsPaused: () => false }))
vi.mock('./agents-store', () => ({
  getAgent: (id: string) => (id === 'triage' ? { id, name: 'Edith', engine: 'claude' } : null)
}))
vi.mock('./agent-runner', () => ({ startAgentRun: mocks.startAgentRun }))
vi.mock('./execution-gate', () => ({
  checkExecutionAdmission: () => ({ allowed: true }),
  isExecutionBlockedError: () => false
}))

const task = { gid: '700001', name: 'Fix it', notes: '', completed: false } as AsanaTask
const prepare = vi.fn()

// A fresh module graph is a fresh app process (new in-memory state and claim owner).
async function startProcess() {
  vi.resetModules()
  const service = await import('./asana-auto-mode-service')
  const ledger = await import('./asana-dispatch-ledger')
  return { auto: service.asanaAutoModeInternals, ledger }
}

beforeEach(() => {
  mocks.userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-asana-producer-'))
  mocks.triageAgentId = 'triage'
  mocks.startAgentRun.mockReset()
  // A triage run that never reports back, as when the app dies mid-run.
  mocks.startAgentRun.mockReturnValue(new Promise(() => {}))
  mocks.appendBriefingItem.mockReset()
})

afterEach(() => {
  rmSync(mocks.userDataDir, { recursive: true, force: true })
})

describe('Asana auto mode producer reconciliation', () => {
  it('re-triages a task whose claim was interrupted by a crash, exactly once (#43)', async () => {
    const first = await startProcess()
    first.auto.maybeDispatchTask(task, 'build', prepare)
    expect(mocks.startAgentRun).toHaveBeenCalledTimes(1)

    const second = await startProcess()
    second.auto.reconcileInterrupted()
    second.auto.maybeDispatchTask(task, 'build', prepare)
    second.auto.maybeDispatchTask(task, 'build', prepare)
    expect(mocks.startAgentRun).toHaveBeenCalledTimes(2)
    expect(second.ledger.listDispatchRecords()).toEqual([
      expect.objectContaining({ gid: task.gid, status: 'claimed', attempts: 1 })
    ])
  })

  it('does not re-triage after a crash when the build was already dispatched (#43)', async () => {
    const first = await startProcess()
    first.auto.maybeDispatchTask(task, 'build', prepare)
    first.ledger.recordBuildDispatched(task.gid)

    const second = await startProcess()
    second.auto.reconcileInterrupted()
    second.auto.maybeDispatchTask(task, 'build', prepare)
    expect(mocks.startAgentRun).toHaveBeenCalledTimes(1)
  })

  it('briefs a dead letter when a second interruption exhausts the attempts', async () => {
    ;(await startProcess()).auto.maybeDispatchTask(task, 'build', prepare)
    const second = await startProcess()
    second.auto.reconcileInterrupted()
    second.auto.maybeDispatchTask(task, 'build', prepare)
    const third = await startProcess()
    third.auto.reconcileInterrupted()
    third.auto.maybeDispatchTask(task, 'build', prepare)

    expect(third.ledger.isDead(task.gid)).toBe(true)
    expect(mocks.startAgentRun).toHaveBeenCalledTimes(2)
    expect(String(mocks.appendBriefingItem.mock.calls.at(-1)?.[0]?.summary)).toContain(
      'dead-lettered'
    )
  })

  it('with no triage agent tasks are blocked, not briefed, and are triaged once one is set (#45)', async () => {
    mocks.triageAgentId = null
    const { auto, ledger } = await startProcess()
    ledger.claimTask('700099', 'review')
    const waiting = ['700001', '700002', '700003'].map((gid) => ({ ...task, gid }))
    for (let tick = 0; tick < 3; tick += 1) {
      for (const each of waiting) {
        auto.maybeDispatchTask(each, 'build', prepare)
      }
      auto.flushNoAgentBrief()
    }
    expect(ledger.listDispatchRecords().map((record) => record.gid)).toEqual(['700099'])
    expect(mocks.startAgentRun).not.toHaveBeenCalled()
    // One aggregate brief for the whole process, not one per task or per tick (F3).
    expect(mocks.appendBriefingItem).toHaveBeenCalledTimes(1)
    const summary = String(mocks.appendBriefingItem.mock.calls[0]?.[0]?.summary)
    expect(summary).toContain('blocked')
    expect(summary).toContain('3 tasks waiting')

    mocks.triageAgentId = 'triage'
    auto.maybeDispatchTask(task, 'build', prepare)
    expect(mocks.startAgentRun).toHaveBeenCalledTimes(1)
    // The unrelated claim is untouched.
    expect(ledger.hasBeenClaimed('700099')).toBe(true)
  })

  it('treats a deleted triage agent the same as none set (#45)', async () => {
    mocks.triageAgentId = 'deleted-agent'
    const { auto, ledger } = await startProcess()
    auto.maybeDispatchTask(task, 'build', prepare)
    expect(ledger.listDispatchRecords()).toEqual([])
    expect(mocks.startAgentRun).not.toHaveBeenCalled()
  })
})
