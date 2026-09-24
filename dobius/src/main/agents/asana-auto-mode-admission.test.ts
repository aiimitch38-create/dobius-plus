import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AsanaTask } from '../../shared/asana'
import type * as ExecutionGateModule from './execution-gate'

const mocks = vi.hoisted(() => ({
  allowed: true,
  claimTask: vi.fn(),
  recordFailure: vi.fn(),
  releaseClaim: vi.fn(),
  startAgentRun: vi.fn()
}))

vi.mock('../asana/asana-config', () => ({
  getAsanaConfig: () => ({ autoMode: { triageAgentId: 'triage' } })
}))
vi.mock('../asana/asana-queue-service', () => ({ refreshAsanaTasks: vi.fn() }))
vi.mock('../asana/asana-token-store', () => ({ hasAsanaToken: () => true }))
vi.mock('./agent-briefing-store', () => ({ appendBriefingItem: vi.fn() }))
vi.mock('./agent-notification-store', () => ({ appendAgentNotification: vi.fn() }))
vi.mock('./agents-config-store', () => ({ getAgentsPaused: () => false }))
vi.mock('./agents-store', () => ({ getAgent: () => ({ id: 'triage' }) }))
vi.mock('./agent-runner', () => ({ startAgentRun: mocks.startAgentRun }))
vi.mock('./asana-dispatch-ledger', () => ({
  claimTask: mocks.claimTask,
  hasBeenClaimed: () => false,
  isDead: () => false,
  pruneOld: vi.fn(),
  recordBriefed: vi.fn(),
  recordFailure: mocks.recordFailure,
  releaseClaim: mocks.releaseClaim
}))
vi.mock('./execution-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionGateModule>()
  return {
    ...actual,
    checkExecutionAdmission: () =>
      mocks.allowed
        ? { allowed: true }
        : { allowed: false, reason: 'paused', message: 'Crew is paused.' }
  }
})

import { ExecutionBlockedError } from './execution-gate'
import { asanaAutoModeInternals } from './asana-auto-mode-service'

const task = { gid: '42', name: 'Fix it', notes: '', completed: false } as AsanaTask
const prepare = vi.fn()

beforeEach(() => {
  mocks.allowed = true
  mocks.claimTask.mockReset()
  mocks.claimTask.mockReturnValue({ gid: '42', status: 'claimed', attempts: 0 })
  mocks.recordFailure.mockReset()
  mocks.releaseClaim.mockReset()
  mocks.startAgentRun.mockReset()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('Asana auto mode admission', () => {
  it('does not claim a task while blocked', () => {
    mocks.allowed = false
    asanaAutoModeInternals.maybeDispatchTask(task, 'build', prepare)
    expect(mocks.claimTask).not.toHaveBeenCalled()
    expect(mocks.startAgentRun).not.toHaveBeenCalled()
  })

  it('releases the claim instead of counting a failure when the run is blocked', async () => {
    mocks.startAgentRun.mockRejectedValue(
      new ExecutionBlockedError('agent-run', 'paused', 'Crew is paused.')
    )
    await asanaAutoModeInternals.dispatchTriage(task, 'build', 'triage', prepare)
    expect(mocks.releaseClaim).toHaveBeenCalledWith('42')
    expect(mocks.recordFailure).not.toHaveBeenCalled()
  })

  it('still records a failure for any other start error', async () => {
    mocks.startAgentRun.mockRejectedValue(new Error('Too many concurrent agent runs'))
    await asanaAutoModeInternals.dispatchTriage(task, 'build', 'triage', prepare)
    expect(mocks.recordFailure).toHaveBeenCalledWith('42')
    expect(mocks.releaseClaim).not.toHaveBeenCalled()
  })
})
