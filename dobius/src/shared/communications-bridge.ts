export const COMMUNICATIONS_BRIDGE_VERSION = 1 as const
export const COMMUNICATIONS_BRIDGE_REQUEST_CHANNEL = 'dobius:communications:request' as const
export const COMMUNICATIONS_BRIDGE_RESPONSE_CHANNEL = 'dobius:communications:response' as const
export const COMMUNICATIONS_BRIDGE_EVENT_CHANNEL = 'dobius:communications:event' as const
export const DOBIUS_COMMUNICATIONS_PARTITION = 'persist:dobius-communications' as const

export const COMMUNICATIONS_BRIDGE_REQUEST_ID_MAX_LENGTH = 128
export const COMMUNICATIONS_BRIDGE_COMMAND_MAX_LENGTH = 128

export type CommunicationsBridgeRequest = {
  version: typeof COMMUNICATIONS_BRIDGE_VERSION
  id: string
  command: string
  args: unknown
}

export type CommunicationsBridgeSuccess = {
  version: typeof COMMUNICATIONS_BRIDGE_VERSION
  id: string
  ok: true
  result: unknown
}

export type CommunicationsBridgeFailure = {
  version: typeof COMMUNICATIONS_BRIDGE_VERSION
  id: string
  ok: false
  error: {
    code: string
    message: string
  }
}

export type CommunicationsBridgeResponse =
  | CommunicationsBridgeSuccess
  | CommunicationsBridgeFailure

export type CommunicationsBridgeEvent = {
  version: typeof COMMUNICATIONS_BRIDGE_VERSION
  name: string
  payload: unknown
}

export const COMMUNICATIONS_RUNTIME_METHODS = [
  'accounts.list',
  // Why: connect_acp_runtime maps a Dobius-native runtime id onto an account
  // switch; these were already implemented elsewhere in the RPC registry but
  // unreachable from Communications until now.
  'accounts.selectClaude',
  'accounts.selectCodex',
  'agent.create',
  'agent.delete',
  'agent.list',
  // Why: message-to-agent dispatch calls agent.run to START a run; 'agent.runs'
  // only LISTS them. Omitting it made every agent silently unreachable from
  // Communications — the bridge rejected the call as command_not_allowed.
  'agent.run',
  'agent.runs',
  // Why: set_persona_active/set_persona_shared re-read the agent record after
  // mutating a local override, to project it back into the Persona shape.
  'agent.show',
  'agent.update',
  'agentApprovals.deny',
  'agentApprovals.grant',
  'agentApprovals.listForRun',
  'agentConfig.get',
  'agentConfig.set',
  'agentHarness.delete',
  'agentHarness.save',
  'agentLocalOverrides.get',
  'agentLocalOverrides.set',
  'agentManagedProfiles.get',
  'agentManagedProfiles.set',
  'agentObserverIndex.readForChannel',
  'agentObserverIndex.write',
  'communications.identity.archiveEvents',
  'communications.identity.archiveIdentity',
  'communications.identity.createNcryptsecBackup',
  'communications.identity.exportNsec',
  'communications.identity.generateBackupPassphrase',
  'communications.identity.getLegacyWorkspaceStorage',
  'communications.identity.importIdentity',
  'communications.identity.listArchivedIdentities',
  'communications.identity.nip44DecryptFromSelf',
  'communications.identity.nip44EncryptToSelf',
  'communications.identity.persistCurrentIdentity',
  'communications.identity.readArchivedEvents',
  'communications.identity.resolveOaOwner',
  'communications.identity.saveNcryptsecCopy',
  'communications.identity.signNostrIdentityBinding',
  'communications.identity.signOut',
  'communications.identity.unarchiveIdentity',
  'communications.identity.verifyNcryptsecBackup',
  'huddle.addAgent',
  'huddle.confirmActive',
  'huddle.end',
  'huddle.getAgentPubkeys',
  'huddle.getState',
  'huddle.getVoiceInputMode',
  'huddle.join',
  'huddle.leave',
  'huddle.reconnectAudio',
  'huddle.setTranscriptionEnabled',
  'huddle.setTtsEnabled',
  'huddle.setVoiceInputMode',
  'huddle.speak',
  'huddle.start',
  'media.copyImageToClipboard',
  'media.copyTextToClipboard',
  'media.downloadFile',
  'media.downloadImage',
  'nativeUx.getIdleSeconds',
  'nativeUx.performSidebarHaptic',
  'nativeUx.setWindowVibrancy',
  'nativeUx.showNotification',
  'nativeUx.titleBarDoubleClick',
  'nativeUx.trayClearAgentActivity',
  'nativeUx.trayRequeueActions',
  'nativeUx.trayTakeActions',
  'nativeUx.trayUpdateAgentActivity',
  'repo.list',
  // Why: get_model_status projects the existing STT model-download state
  // into Buzz's model-status shape; already implemented, just unreachable.
  'speech.models.list',
  'status.get',
  'team.create',
  'team.delete',
  'team.list',
  'team.update',
  'terminal.list',
  'updater.isAutoUpdateSupported',
  'worktree.ps'
] as const

export type CommunicationsRuntimeMethod = (typeof COMMUNICATIONS_RUNTIME_METHODS)[number]

const communicationsRuntimeMethodSet = new Set<string>(COMMUNICATIONS_RUNTIME_METHODS)

export function isCommunicationsRuntimeMethod(value: string): value is CommunicationsRuntimeMethod {
  return communicationsRuntimeMethodSet.has(value)
}

function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

export function isCommunicationsBridgeRequest(value: unknown): value is CommunicationsBridgeRequest {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<CommunicationsBridgeRequest>
  return (
    candidate.version === COMMUNICATIONS_BRIDGE_VERSION &&
    isBoundedNonEmptyString(candidate.id, COMMUNICATIONS_BRIDGE_REQUEST_ID_MAX_LENGTH) &&
    isBoundedNonEmptyString(candidate.command, COMMUNICATIONS_BRIDGE_COMMAND_MAX_LENGTH) &&
    Object.hasOwn(candidate, 'args')
  )
}
