import { contextBridge, ipcRenderer } from 'electron'
import {
  COMMUNICATIONS_BRIDGE_REQUEST_CHANNEL,
  COMMUNICATIONS_BRIDGE_VERSION,
  type CommunicationsBridgeRequest,
  type CommunicationsBridgeResponse
} from '../shared/communications-bridge'

let requestSequence = 0

contextBridge.exposeInMainWorld('dobiusCommunications', {
  invoke(command: string, args: unknown = {}): Promise<CommunicationsBridgeResponse> {
    requestSequence += 1
    const request: CommunicationsBridgeRequest = {
      version: COMMUNICATIONS_BRIDGE_VERSION,
      id: `communications-${requestSequence}`,
      command,
      args
    }
    return ipcRenderer.invoke(COMMUNICATIONS_BRIDGE_REQUEST_CHANNEL, request)
  }
})

