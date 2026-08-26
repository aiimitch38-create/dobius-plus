import { contextBridge, ipcRenderer } from 'electron'
import {
  COMMUNICATIONS_BRIDGE_REQUEST_CHANNEL,
  COMMUNICATIONS_BRIDGE_VERSION,
  type CommunicationsBridgeRequest,
  type CommunicationsBridgeResponse
} from '../shared/communications-bridge'
import {
  COMMUNICATIONS_RELAY_STATUS_CHANNEL,
  type CommunicationsRelayStatus
} from '../shared/communications-relay-status'

let requestSequence = 0

/**
 * Idempotent exposure: the guest webview entry runs this at import time and
 * the main-window preload calls it explicitly, so the same bundled module
 * must tolerate both paths without re-exposing in one context.
 */
export function exposeCommunicationsBridge(): void {
  if ('dobiusCommunications' in window) {
    return
  }
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
  },
  relayStatus(): Promise<CommunicationsRelayStatus> {
    return ipcRenderer.invoke(COMMUNICATIONS_RELAY_STATUS_CHANNEL)
  }
  })
}

exposeCommunicationsBridge()

