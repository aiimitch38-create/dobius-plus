import { ipcMain } from 'electron'
import {
  ensureParticipantIdentity,
  signParticipantEvent,
  type ParticipantPublicIdentity,
  type SignedCommunicationsEvent,
  type UnsignedCommunicationsEvent
} from '../communications/participant-identity-store'
import { ensureAgentIdentity, signAsAgent } from '../communications/agent-participant-identity-store'
import {
  archiveEvents,
  readArchivedEvents,
  type ArchiveBatchResult,
  type ArchiveCandidate,
  type ArchivedRelayEvent,
  type ArchiveScopeType,
  type ReadArchivedEventsOptions
} from '../communications/identity/event-archive-store'
import {
  archiveIdentity,
  listArchivedIdentities,
  resolveOaOwner,
  unarchiveIdentity,
  type ArchivedIdentitiesSnapshot,
  type IdentityArchiveRequest,
  type IdentityUnarchiveRequest,
  type OwnerOfAgent
} from '../communications/identity/identity-archival-relay'
import {
  createNcryptsecBackup,
  exportNsecViaSecureWindow,
  importIdentityViaSecureWindow,
  saveNcryptsecCopy,
  verifyNcryptsecBackup,
  type BackupVerification,
  type ImportIdentityOutcome
} from '../communications/identity/identity-export-import'
import {
  getLegacyWorkspaceStorage,
  persistCurrentIdentity,
  signNostrIdentityBinding,
  signOut,
  type Identity,
  type LegacyWorkspaceStorageSnapshot,
  type NostrIdentityBindingInput
} from '../communications/identity/identity-lifecycle'
import {
  generateBackupPassphrase,
  type GenerateBackupPassphraseOptions
} from '../communications/identity/backup-passphrase'
import { nip44DecryptFromSelf, nip44EncryptToSelf } from '../communications/identity/nip44-self'

// Exposes the Keychain-backed Communications identity (see
// participant-identity-store.ts) to Dobius's own renderer, for the native
// Buzz tab. This is a separate channel from communications-gateway.ts, which
// only trusts the vendored Buzz webview — the native tab runs in the main
// window and needs its own, ordinarily-trusted IPC surface.
//
// The `communications:identity:*` handlers below give the native tab parity
// with the 18 identity-keychain Buzz commands implemented for the vendored
// webview in src/main/communications/identity/identity-rpc-methods.ts. Both
// surfaces call the same underlying identity/*.ts functions — this file adds
// no new logic, only IPC plumbing.
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

  ipcMain.handle(
    'communications:identity:archiveEvents',
    (_event, candidates: ArchiveCandidate[]): ArchiveBatchResult => archiveEvents(candidates)
  )
  ipcMain.handle(
    'communications:identity:readArchivedEvents',
    (
      _event,
      scopeType: ArchiveScopeType,
      scopeValue: string,
      options?: ReadArchivedEventsOptions
    ): ArchivedRelayEvent[] => readArchivedEvents(scopeType, scopeValue, options)
  )
  ipcMain.handle(
    'communications:identity:archiveIdentity',
    (_event, req: IdentityArchiveRequest): Promise<void> => archiveIdentity(req)
  )
  ipcMain.handle(
    'communications:identity:unarchiveIdentity',
    (_event, req: IdentityUnarchiveRequest): Promise<void> => unarchiveIdentity(req)
  )
  ipcMain.handle(
    'communications:identity:listArchivedIdentities',
    (): Promise<ArchivedIdentitiesSnapshot> => listArchivedIdentities()
  )
  ipcMain.handle(
    'communications:identity:resolveOaOwner',
    (_event, targetPubkey: string): Promise<OwnerOfAgent | null> => resolveOaOwner(targetPubkey)
  )
  ipcMain.handle(
    'communications:identity:persistCurrentIdentity',
    (): Identity => persistCurrentIdentity()
  )
  ipcMain.handle('communications:identity:signOut', (): void => signOut())
  ipcMain.handle(
    'communications:identity:getLegacyWorkspaceStorage',
    (): LegacyWorkspaceStorageSnapshot => getLegacyWorkspaceStorage()
  )
  ipcMain.handle(
    'communications:identity:signNostrIdentityBinding',
    (_event, input: NostrIdentityBindingInput): string => signNostrIdentityBinding(input)
  )
  // Reveal/import move the key through secure-key-entry-window.ts's own
  // trusted window — no private key is ever part of these IPC replies.
  ipcMain.handle(
    'communications:identity:exportNsec',
    (): Promise<{ shown: true }> => exportNsecViaSecureWindow()
  )
  ipcMain.handle(
    'communications:identity:importIdentity',
    (): Promise<ImportIdentityOutcome> => importIdentityViaSecureWindow()
  )
  ipcMain.handle(
    'communications:identity:createNcryptsecBackup',
    (_event, password: string): Promise<string> => createNcryptsecBackup(password)
  )
  ipcMain.handle(
    'communications:identity:saveNcryptsecCopy',
    (_event, ncryptsec: string): Promise<string | null> => saveNcryptsecCopy(ncryptsec)
  )
  ipcMain.handle(
    'communications:identity:verifyNcryptsecBackup',
    (_event, ncryptsec: string, password: string): Promise<BackupVerification> =>
      verifyNcryptsecBackup(ncryptsec, password)
  )
  ipcMain.handle(
    'communications:identity:generateBackupPassphrase',
    (_event, options?: GenerateBackupPassphraseOptions): string => generateBackupPassphrase(options)
  )
  ipcMain.handle(
    'communications:identity:nip44EncryptToSelf',
    (_event, plaintext: string): string => nip44EncryptToSelf(plaintext)
  )
  ipcMain.handle(
    'communications:identity:nip44DecryptFromSelf',
    (_event, payload: string): string => nip44DecryptFromSelf(payload)
  )
}
