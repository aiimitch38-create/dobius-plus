import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  allowed: true,
  sendImessage: vi.fn(async () => {})
}))

vi.mock('../sqlite/sync-database', () => ({ default: vi.fn() }))
vi.mock('./imessage-send', () => ({
  sendImessage: mocks.sendImessage,
  countOutboundLastMinute: () => 0
}))
vi.mock('./bridge-config', () => ({
  getImessageBridgeConfig: vi.fn(),
  updateImessageBridgeConfig: vi.fn()
}))
vi.mock('../agents/agent-channel-service', () => ({ handleChannelMessage: vi.fn() }))
vi.mock('../agents/execution-gate', () => ({
  checkExecutionAdmission: () =>
    mocks.allowed
      ? { allowed: true }
      : { allowed: false, reason: 'paused', message: 'Crew is paused.' }
}))

import { bridgeServiceInternals } from './bridge-service'

function terminal() {
  return {
    resolveActiveTerminal: vi.fn(async () => 'term-1'),
    getTerminalAgentStatus: vi.fn(async () => ({ isRunningAgent: true, status: 'working' })),
    sendTerminal: vi.fn(async () => undefined)
  }
}

beforeEach(() => {
  mocks.allowed = true
  mocks.sendImessage.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('iMessage d: command admission', () => {
  it('refuses to type into the terminal while the crew is paused', async () => {
    mocks.allowed = false
    const target = terminal()
    await bridgeServiceInternals.dispatchCommand('echo hi', 'me', target)

    expect(target.sendTerminal).not.toHaveBeenCalled()
    expect(target.resolveActiveTerminal).not.toHaveBeenCalled()
    expect(mocks.sendImessage).toHaveBeenCalledWith('me', expect.stringContaining('paused'))
  })

  it('types the command and presses Enter when allowed', async () => {
    const target = terminal()
    await bridgeServiceInternals.dispatchCommand('echo hi', 'me', target)

    expect(target.resolveActiveTerminal).toHaveBeenCalledTimes(1)
    expect(target.sendTerminal).toHaveBeenCalledWith(
      'term-1',
      { text: 'echo hi', enter: true },
      expect.objectContaining({ beforeWrite: expect.any(Function) })
    )
  })
})
