import { ipcMain } from 'electron'
import {
  ensureParticipantIdentity,
  signParticipantEvent,
  type ParticipantPublicIdentity,
  type SignedCommunicationsEvent,
  type UnsignedCommunicationsEvent
} from '../communications/participant-identity-store'
import { ensureAgentIdentity, signAsAgent } from '../communications/agent-participant-identity-store'

// Exposes the Keychain-backed Communications identity (see
// participant-identity-store.ts) to Dobius's own renderer, for the native
// Buzz tab. This is a separate channel from communications-gateway.ts, which
// only trusts the vendored Buzz webview — the native tab runs in the main
// window and needs its own, ordinarily-trusted IPC surface.
export function registerCommunicationsIdentityHandlers(): void {
  ipcMain.handle(
    'communications:getIdentity',
    (): ParticipantPublicIdentity => ensureParticipantIdentity()
  )
  ipcMain.handle(
    'communications:signEvent',
    (_event, unsigned: UnsignedCommunicationsEvent): SignedCommunicationsEvent =>
      signParticipantEvent(unsigned)
  )
  ipcMain.handle(
    'communications:getAgentIdentity',
    (_event, agentId: string): { pubkey: string } => ensureAgentIdentity(agentId)
  )
  ipcMain.handle(
    'communications:signEventAsAgent',
    (_event, agentId: string, unsigned: UnsignedCommunicationsEvent): SignedCommunicationsEvent =>
      signAsAgent(agentId, unsigned)
  )
}
