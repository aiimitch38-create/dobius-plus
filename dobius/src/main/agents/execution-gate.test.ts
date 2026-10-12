import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getAgentsControlState: vi.fn() }))

vi.mock('./agents-config-store', () => ({
  getAgentsControlState: mocks.getAgentsControlState
}))

import {
  assertExecutionAdmitted,
  checkExecutionAdmission,
  isExecutionBlockedError,
  type ExecutionOrigin
} from './execution-gate'

const AUTONOMOUS: ExecutionOrigin[] = ['agent-run', 'dispatch-build', 'imessage-command']

function state(patch: { paused?: boolean; status?: 'ok' | 'missing' | 'unreadable' }) {
  return {
    paused: patch.paused ?? false,
    status: patch.status ?? 'ok',
    detail: patch.status === 'unreadable' ? 'invalid JSON' : null,
    filePath: '/data/agents-config.json'
  }
}

beforeEach(() => {
  mocks.getAgentsControlState.mockReset()
})

describe('execution gate', () => {
  it('allows every origin when unpaused', () => {
    mocks.getAgentsControlState.mockReturnValue(state({}))
    for (const origin of [...AUTONOMOUS, 'agents-page' as const]) {
      expect(checkExecutionAdmission(origin)).toEqual({ allowed: true })
    }
  })

  it('allows only the Agents page while paused', () => {
    mocks.getAgentsControlState.mockReturnValue(state({ paused: true }))
    expect(checkExecutionAdmission('agents-page')).toEqual({ allowed: true })
    for (const origin of AUTONOMOUS) {
      expect(checkExecutionAdmission(origin)).toMatchObject({ allowed: false, reason: 'paused' })
    }
  })

  it('allows only the Agents page while the control file is unreadable', () => {
    mocks.getAgentsControlState.mockReturnValue(state({ paused: true, status: 'unreadable' }))
    expect(checkExecutionAdmission('agents-page')).toEqual({ allowed: true })
    const denied = checkExecutionAdmission('agent-run')
    expect(denied).toMatchObject({ allowed: false, reason: 'control-state-unreadable' })
    expect(denied.allowed ? '' : denied.message).toContain('/data/agents-config.json')
  })

  it('fails closed when reading the control state throws', () => {
    mocks.getAgentsControlState.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(checkExecutionAdmission('dispatch-build')).toMatchObject({
      allowed: false,
      reason: 'control-state-unreadable'
    })
  })

  it('throws a recognizable error from assertExecutionAdmitted', () => {
    mocks.getAgentsControlState.mockReturnValue(state({ paused: true }))
    let caught: unknown
    try {
      assertExecutionAdmitted('agent-run')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).name).toBe('ExecutionBlockedError')
    expect(isExecutionBlockedError(caught)).toBe(true)
    expect(isExecutionBlockedError(new Error('x'))).toBe(false)
  })
})
