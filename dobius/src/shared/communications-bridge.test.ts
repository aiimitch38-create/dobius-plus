import { describe, expect, it } from 'vitest'
import {
  COMMUNICATIONS_BRIDGE_COMMAND_MAX_LENGTH,
  COMMUNICATIONS_BRIDGE_REQUEST_ID_MAX_LENGTH,
  COMMUNICATIONS_BRIDGE_VERSION,
  isCommunicationsBridgeRequest
} from './communications-bridge'

describe('communications bridge request validation', () => {
  it('accepts the versioned request envelope', () => {
    expect(
      isCommunicationsBridgeRequest({
        version: COMMUNICATIONS_BRIDGE_VERSION,
        id: 'request-1',
        command: 'get_channels',
        args: {}
      })
    ).toBe(true)
  })

  it.each([
    null,
    {},
    { version: 2, id: 'request-1', command: 'get_channels', args: {} },
    { version: 1, id: '', command: 'get_channels', args: {} },
    { version: 1, id: 'request-1', command: '', args: {} },
    { version: 1, id: 'request-1', command: 'get_channels' },
    {
      version: 1,
      id: 'x'.repeat(COMMUNICATIONS_BRIDGE_REQUEST_ID_MAX_LENGTH + 1),
      command: 'get_channels',
      args: {}
    },
    {
      version: 1,
      id: 'request-1',
      command: 'x'.repeat(COMMUNICATIONS_BRIDGE_COMMAND_MAX_LENGTH + 1),
      args: {}
    }
  ])('rejects malformed or unsupported envelopes', (value) => {
    expect(isCommunicationsBridgeRequest(value)).toBe(false)
  })
})

