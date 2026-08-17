import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMUNICATIONS_BRIDGE_REQUEST_CHANNEL,
  COMMUNICATIONS_BRIDGE_VERSION
} from '../../shared/communications-bridge'

const { dispatchMock, handleMock, removeHandlerMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  handleMock: vi.fn(),
  removeHandlerMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, removeHandler: removeHandlerMock }
}))

vi.mock('../runtime/rpc/dispatcher', () => ({
  RpcDispatcher: vi.fn(function () {
    return { dispatch: dispatchMock }
  })
}))

import { registerCommunicationsGateway } from './communications-gateway'

function registeredHandler(): (event: unknown, value: unknown) => Promise<unknown> {
  const registration = handleMock.mock.calls.find(
    ([channel]) => channel === COMMUNICATIONS_BRIDGE_REQUEST_CHANNEL
  )
  expect(registration).toBeTruthy()
  return registration![1]
}

const trustedEvent = {
  sender: {
    getURL: () => 'http://localhost:5173/buzz/index.html?embed=dobius'
  }
}

describe('Communications gateway', () => {
  beforeEach(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/')
    dispatchMock.mockReset()
    handleMock.mockReset()
    removeHandlerMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('dispatches an allowlisted request through the Dobius runtime', async () => {
    dispatchMock.mockResolvedValue({ ok: true, result: { agents: [] } })
    registerCommunicationsGateway({} as never)

    const result = await registeredHandler()(trustedEvent, {
      version: COMMUNICATIONS_BRIDGE_VERSION,
      id: 'request-1',
      command: 'agent.list',
      args: {}
    })

    expect(dispatchMock).toHaveBeenCalledWith({
      id: 'request-1',
      authToken: 'communications-guest',
      method: 'agent.list',
      params: {}
    })
    expect(result).toMatchObject({ ok: true, id: 'request-1', result: { agents: [] } })
  })

  it('rejects unknown commands before runtime dispatch', async () => {
    registerCommunicationsGateway({} as never)
    const result = await registeredHandler()(trustedEvent, {
      version: COMMUNICATIONS_BRIDGE_VERSION,
      id: 'request-2',
      command: 'terminal.send',
      args: { text: 'unsafe' }
    })
    expect(dispatchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, error: { code: 'command_not_allowed' } })
  })

  it('rejects requests from any page outside the bundled Communications entry', async () => {
    registerCommunicationsGateway({} as never)
    const result = await registeredHandler()(
      { sender: { getURL: () => 'https://example.com/buzz/index.html?embed=dobius' } },
      {
        version: COMMUNICATIONS_BRIDGE_VERSION,
        id: 'request-3',
        command: 'agent.list',
        args: {}
      }
    )
    expect(dispatchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, error: { code: 'untrusted_sender' } })
  })
})
