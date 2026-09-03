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
  // Live outbox delivery for channel runs — separate from agent.runs so the
  // 750ms poll never carries base64 image blobs.
  'agent.runOutbox',
  // Snapshot family (snapshots/snapshot-rpc-methods.ts) — registered in
  // ALL_RPC_METHODS but previously unreachable from Communications.
  'agent.snapshot.confirmImport',
  'agent.snapshot.encode',
  'agent.snapshot.export',
  'agent.snapshot.previewImport',
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
  'agentObserver.buildControlEvent',
  'agentObserver.decryptEvent',
  'agentObserverIndex.readForChannel',
  'agentObserverIndex.write',
  // Canvas-notes family (communications/canvas/canvas-rpc-methods.ts).
  'canvas.getCanvas',
  'canvas.getGlobalNotes',
  'canvas.getLikedNotes',
  'canvas.getNote',
  'canvas.getNoteReactions',
  'canvas.getNotesTimeline',
  'canvas.getUserNotes',
  'canvas.publishNote',
  'canvas.setCanvas',
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
  // Channel-template family (runtime/rpc/methods/channel-templates.ts).
  'channelTemplate.create',
  'channelTemplate.delete',
  'channelTemplate.duplicate',
  'channelTemplate.list',
  'channelTemplate.show',
  'channelTemplate.update',
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
  'media.fetchBytes',
  'media.getProxyPort',
  'media.pickAndUploadImage',
  'media.pickAndUploadMedia',
  'media.upload',
  'media.uploadBytes',
  'nativeUx.getIdleSeconds',
  'nativeUx.performSidebarHaptic',
  'nativeUx.setWindowVibrancy',
  'nativeUx.showNotification',
  'nativeUx.titleBarDoubleClick',
  'nativeUx.trayClearAgentActivity',
  'nativeUx.trayRequeueActions',
  'nativeUx.trayTakeActions',
  'nativeUx.trayUpdateAgentActivity',
  // Save-subscription family (runtime/rpc/methods/save-subscriptions.ts).
  'saveSubscription.create',
  'saveSubscription.delete',
  'saveSubscription.list',
  'saveSubscription.mergeKind',
  'saveSubscription.removeKind',
  'snapshot.fetchBytes',
  'repo.list',
  // Why: get_model_status projects the existing STT model-download state
  // into Buzz's model-status shape; already implemented, just unreachable.
  'speech.models.list',
  'status.get',
  'team.create',
  'team.delete',
  'team.list',
  'team.snapshot.confirmImport',
  'team.snapshot.encode',
  'team.snapshot.export',
  'team.snapshot.previewImport',
  'team.update',
  'terminal.list',
  'updater.isAutoUpdateSupported',
  // Workflow family (workflows/workflow-rpc-methods.ts).
  'workflow.create',
  'workflow.delete',
  'workflow.listByChannel',
  'workflow.listByChannels',
  'workflow.runs',
  'workflow.show',
  'workflow.trigger',
  'workflow.update',
  // Workstation family (workstation/rpc-methods.ts).
  'workstationGit.checkPipelineHotstart',
  'workstationGit.cloneRepository',
  'workstationGit.createRemoteBranch',
  'workstationGit.deleteRemoteBranch',
  'workstationGit.discoverGitBashPrerequisite',
  'workstationGit.fetchWorkspaceIcon',
  'workstationGit.getIdentity',
  'workstationGit.getLocalDiff',
  'workstationGit.getLocalSnapshot',
  'workstationGit.getRemoteDiff',
  'workstationGit.getRemoteSnapshot',
  'workstationGit.getSyncStatus',
  'workstationGit.listLocalRepositories',
  'workstationGit.mergePullRequest',
  'workstationGit.openMergeRecoveryTerminal',
  'workstationGit.openTerminal',
  'workstationGit.publishPullRequestMergedStatus',
  'workstationGit.pull',
  'workstationGit.push',
  'workstationGit.signPullRequestReviewRequest',
  'workstationGit.signPullRequestStatus',
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
