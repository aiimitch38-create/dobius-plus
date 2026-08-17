import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  COMMUNICATIONS_BRIDGE_REQUEST_CHANNEL,
  COMMUNICATIONS_BRIDGE_VERSION,
  isCommunicationsBridgeRequest,
  isCommunicationsRuntimeMethod,
  type CommunicationsBridgeFailure,
  type CommunicationsBridgeResponse
} from '../../shared/communications-bridge'
import type { DobiusRuntimeService } from '../runtime/dobius-runtime'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { isTrustedCommunicationsGuestUrl } from './communications-guest'

function failure(id: string, code: string, message: string): CommunicationsBridgeFailure {
  return {
    version: COMMUNICATIONS_BRIDGE_VERSION,
    id,
    ok: false,
    error: { code, message }
  }
}

export function registerCommunicationsGateway(runtime: DobiusRuntimeService): void {
  ipcMain.removeHandler(COMMUNICATIONS_BRIDGE_REQUEST_CHANNEL)
  const dispatcher = new RpcDispatcher({ runtime })

  ipcMain.handle(
    COMMUNICATIONS_BRIDGE_REQUEST_CHANNEL,
    async (event: IpcMainInvokeEvent, value: unknown): Promise<CommunicationsBridgeResponse> => {
      // Why: this bridge can control real workstation state. Validate both the
      // immutable bundled entry URL and every request even though the preload
      // also constructs a typed envelope.
      if (!isTrustedCommunicationsGuestUrl(event.sender.getURL())) {
        return failure('unknown', 'untrusted_sender', 'Communications bridge access denied')
      }
      if (!isCommunicationsBridgeRequest(value)) {
        return failure('unknown', 'invalid_request', 'Invalid Communications bridge request')
      }
      if (!isCommunicationsRuntimeMethod(value.command)) {
        return failure(value.id, 'command_not_allowed', `Unsupported command: ${value.command}`)
      }

      const response = await dispatcher.dispatch({
        id: value.id,
        authToken: 'communications-guest',
        method: value.command,
        params: value.args
      })
      if (!response.ok) {
        return failure(value.id, response.error.code, response.error.message)
      }
      return {
        version: COMMUNICATIONS_BRIDGE_VERSION,
        id: value.id,
        ok: true,
        result: response.result
      }
    }
  )
}

