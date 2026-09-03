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

// Why a module flag rather than sniffing `window`: the old guard tested
// `'dobiusCommunications' in window`, but with contextIsolation on, this file
// runs in the isolated world while exposeInMainWorld writes to the main one.
// The guard could never see its own work, so a second call always reached
// exposeInMainWorld and threw "Cannot bind an API on top of an existing
// property", aborting the rest of the preload.
let bridgeExposed = false

/** Idempotent exposure — see the flag above for why it is not a window check. */
export function exposeCommunicationsBridge(): void {
  if (bridgeExposed) {
    return
  }
  bridgeExposed = true
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

// No import-time call. This module used to be the guest webview's own preload
// entry and self-exposed on import; that webview was retired in fdcffaaf, and
// the main-window preload calls exposeCommunicationsBridge() explicitly. The
// leftover call ran a second time and threw, killing everything after it in
// index.ts — silently, because it is the last statement there today.

