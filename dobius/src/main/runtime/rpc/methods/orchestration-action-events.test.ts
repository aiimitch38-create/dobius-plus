import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'

const mocks = vi.hoisted(() => ({
  emitDobiusActionEvent: vi.fn(),
  updateTaskStatus: vi.fn(),
  resolveGate: vi.fn()
}))

vi.mock('../../../agents/dobius-action-events', () => ({
  emitDobiusActionEvent: mocks.emitDobiusActionEvent,
  newActionContext: () => ({ correlationId: 'fresh' })
}))
vi.mock('../../../agents/execution-gate', () => ({
  assertExecutionAdmitted: vi.fn()
}))

import { ORCHESTRATION_METHODS } from './orchestration'
import { ORCHESTRATION_GATE_METHODS } from './orchestration-gates'

const runtime = {
  getOrchestrationDb: () => ({
    updateTaskStatus: mocks.updateTaskStatus,
    resolveGate: mocks.resolveGate
  })
} as unknown as DobiusRuntimeService
const ctx = { runtime } as RpcContext

function method(name: string) {
  const found = [...ORCHESTRATION_METHODS, ...ORCHESTRATION_GATE_METHODS].find(
    (candidate) => candidate.name === name
  )
  if (!found) {
    throw new Error(`method ${name} not registered`)
  }
  return found
}

describe('orchestration RPC → ADAM ledger (B3)', () => {
  beforeEach(() => {
    mocks.emitDobiusActionEvent.mockReset()
    mocks.updateTaskStatus.mockReset()
    mocks.resolveGate.mockReset()
  })

  it('orchestration.taskUpdate emits one task.status.changed keyed by the task id', async () => {
    mocks.updateTaskStatus.mockReturnValue({
      id: 'task-1',
      status: 'completed',
      task_title: 'Ship it',
      spec: 'a very long spec that must not be copied into the ledger'
    })

    expect(
      method('orchestration.taskUpdate').handler(
        { id: 'task-1', status: 'completed', result: 'done' },
        ctx
      )
    ).toMatchObject({ task: { id: 'task-1' } })

    expect(mocks.emitDobiusActionEvent).toHaveBeenCalledTimes(1)
    expect(mocks.emitDobiusActionEvent).toHaveBeenCalledWith({
      type: 'task.status.changed',
      actor: 'runtime',
      context: { correlationId: 'task-1' },
      payload: { taskId: 'task-1', status: 'completed', title: 'Ship it', result: 'done' }
    })
  })

  it('orchestration.taskUpdate emits nothing when the task is missing', () => {
    mocks.updateTaskStatus.mockReturnValue(undefined)
    expect(() =>
      method('orchestration.taskUpdate').handler({ id: 'nope', status: 'completed' }, ctx)
    ).toThrow('Task not found')
    expect(mocks.emitDobiusActionEvent).not.toHaveBeenCalled()
  })

  it('orchestration.gateResolve emits one task.gate.resolved keyed by the gated task', async () => {
    mocks.resolveGate.mockReturnValue({
      id: 'gate-1',
      task_id: 'task-7',
      question: 'Merge or rebase?',
      status: 'resolved',
      resolution: 'rebase'
    })

    expect(
      method('orchestration.gateResolve').handler({ id: 'gate-1', resolution: 'rebase' }, ctx)
    ).toMatchObject({ gate: { id: 'gate-1' } })

    expect(mocks.emitDobiusActionEvent).toHaveBeenCalledTimes(1)
    expect(mocks.emitDobiusActionEvent).toHaveBeenCalledWith({
      type: 'task.gate.resolved',
      actor: 'runtime',
      context: { correlationId: 'task-7' },
      payload: {
        gateId: 'gate-1',
        taskId: 'task-7',
        question: 'Merge or rebase?',
        resolution: 'rebase'
      }
    })
  })

  it('orchestration.gateResolve emits nothing when the gate is missing', () => {
    mocks.resolveGate.mockReturnValue(undefined)
    expect(() =>
      method('orchestration.gateResolve').handler({ id: 'nope', resolution: 'x' }, ctx)
    ).toThrow('Gate not found')
    expect(mocks.emitDobiusActionEvent).not.toHaveBeenCalled()
  })
})
