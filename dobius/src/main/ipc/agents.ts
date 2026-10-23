import { dialog, ipcMain } from 'electron'
import type {
  AgentCrewFileName,
  AgentIdentityFileName,
  AgentDecisionResolution,
  AgentsExecutionState,
  BriefingItem,
  CustomAgentInput,
  CustomAgentUpdate
} from '../../shared/agents'
import type { Store } from '../persistence'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import {
  createAgent,
  getAgent,
  listAgents,
  removeAgent,
  resetAgentSession,
  updateAgent
} from '../agents/agents-store'
import { listAgentRuns, startAgentRun, stopAgentRun } from '../agents/agent-runner'
import { setDefaultPrepareClaudeLaunch } from '../agents/default-claude-launch'
import {
  setDefaultPrepareCodexLaunch,
  type PrepareCodexLaunch
} from '../agents/default-codex-launch'
import { listAgentDecisions, resolveAgentDecision } from '../agents/agent-decision-queue'
import { getVoiceConductorReply, postVoiceConductorTranscript } from '../voice-conductor/service'
import {
  listAgentNotifications,
  markAgentNotificationsRead
} from '../agents/agent-notification-store'
import { dismissBriefingItems, listRecentBriefingItems } from '../agents/agent-briefing-store'
import {
  getAgentsControlState,
  getAgentsPaused,
  getPingStatus,
  setAgentsPaused
} from '../agents/agents-config-store'
import { startAgentHeartbeats } from '../agents/agent-heartbeat-service'
import { startAsanaAutoMode } from '../agents/asana-auto-mode-service'
import { listDrafts, setDraftStatus } from '../agents/agent-draft-store'
import { approveDraftAndPost } from '../agents/agent-draft-approval'
import { setDobiusToolKnowledgeStore } from '../agents/agent-tools/dobius-tool-server'
import {
  parseExpectedAgentFile,
  readAgentFiles,
  readCrewFiles,
  writeAgentFile,
  writeCrewFile
} from '../agents/agent-identity-files'
import {
  deleteCustomHarness,
  listCustomHarnesses,
  saveCustomHarness,
  type CustomHarnessDefinition
} from '../communications/agents/custom-harness-store'
import {
  getCustomHarnessProvider,
  listCustomHarnessStatuses,
  stopCustomHarness
} from '../communications/providers/custom-harness-instances'
import { validateCustomHarnessDefinition } from '../communications/providers/custom-harness-provider'
import {
  clearProviderApiKey,
  hasProviderApiKey,
  saveProviderApiKey,
  type ProviderKeyId
} from '../communications/providers/provider-api-key-store'

type PrepareClaudeLaunch = (target?: {
  accountId?: string | null
}) => Promise<ClaudeRuntimeAuthPreparation>

export function registerAgentsHandlers(
  prepareClaudeLaunch: PrepareClaudeLaunch,
  prepareCodexLaunch: PrepareCodexLaunch,
  store: Store
): void {
  setDobiusToolKnowledgeStore(store)
  setDefaultPrepareClaudeLaunch(prepareClaudeLaunch)
  setDefaultPrepareCodexLaunch(prepareCodexLaunch)
  startAgentHeartbeats(prepareClaudeLaunch)
  startAsanaAutoMode(prepareClaudeLaunch)
  // Board dispatch deliberately does NOT run here. It lives in the renderer
  // (components/kanban/board-dispatch.ts) because an agent can only post
  // progress and screenshots from a run started through the Communications
  // channel path — identity, signing and the outbox drain all live there.
  // Dispatching from main gave the agent posting tools whose output silently
  // went nowhere. Two dispatchers would also both claim the same task.

  ipcMain.removeHandler('agents:list')
  ipcMain.handle('agents:list', () => listAgents())

  ipcMain.removeHandler('agents:create')
  ipcMain.handle('agents:create', (_event, input: CustomAgentInput) => createAgent(input))

  ipcMain.removeHandler('agents:update')
  ipcMain.handle('agents:update', (_event, id: string, updates: CustomAgentUpdate) =>
    updateAgent(id, updates)
  )

  ipcMain.removeHandler('agents:delete')
  ipcMain.handle('agents:delete', (_event, id: string) => removeAgent(id))

  // Why: agentId is renderer-supplied — resolve it to a known agent before any
  // filesystem access (defense in depth with the path guard in agent-identity-files).
  const requireAgentId = (agentId: string): string => {
    const agent = getAgent(agentId)
    if (!agent) {
      throw new Error('Agent not found')
    }
    return agent.id
  }

  ipcMain.removeHandler('agents:readFiles')
  ipcMain.handle('agents:readFiles', (_event, agentId: string) =>
    readAgentFiles(requireAgentId(agentId))
  )

  ipcMain.removeHandler('agents:writeFile')
  ipcMain.handle(
    'agents:writeFile',
    (
      _event,
      agentId: string,
      name: AgentIdentityFileName | 'brief' | 'memory',
      content: string,
      expected?: unknown
    ) => writeAgentFile(requireAgentId(agentId), name, content, parseExpectedAgentFile(expected))
  )

  ipcMain.removeHandler('agents:readCrewFiles')
  ipcMain.handle('agents:readCrewFiles', () => readCrewFiles())

  ipcMain.removeHandler('agents:writeCrewFile')
  ipcMain.handle('agents:writeCrewFile', (_event, name: AgentCrewFileName, content: string) =>
    writeCrewFile(name, content)
  )

  ipcMain.removeHandler('agents:resetSession')
  ipcMain.handle('agents:resetSession', (_event, id: string) => resetAgentSession(id))

  ipcMain.removeHandler('agents:run')
  ipcMain.handle('agents:run', (_event, args: { agentId: string; prompt: string }) =>
    startAgentRun({
      ...args,
      prepareClaudeLaunch,
      prepareCodexLaunch,
      // The only operator origin: a human pressed Run on the Agents page.
      options: { origin: 'agents-page' }
    })
  )

  ipcMain.removeHandler('agents:stop')
  ipcMain.handle('agents:stop', (_event, runId: string) => stopAgentRun(runId))

  ipcMain.removeHandler('agents:listRuns')
  ipcMain.handle('agents:listRuns', () => listAgentRuns())

  ipcMain.removeHandler('agents:listDecisions')
  ipcMain.handle('agents:listDecisions', () => listAgentDecisions())

  ipcMain.removeHandler('agents:resolveDecision')
  ipcMain.handle('agents:resolveDecision', (_event, resolution: AgentDecisionResolution) =>
    resolveAgentDecision(resolution)
  )

  // Why: the Board command bar drives the same conductor the phone uses, so
  // board orders get full agent tooling (spawn, relay, reply) with no new engine.
  ipcMain.removeHandler('agents:conductorCommand')
  ipcMain.handle(
    'agents:conductorCommand',
    async (_event, input: { requestId: string; transcript: string }) => {
      try {
        await postVoiceConductorTranscript(input)
        return { ok: true as const }
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.removeHandler('agents:conductorReply')
  ipcMain.handle(
    'agents:conductorReply',
    (_event, input: { requestId: string; sinceTs?: number }) =>
      getVoiceConductorReply(input.requestId, input.sinceTs)
  )

  ipcMain.removeHandler('agents:listNotifications')
  ipcMain.handle('agents:listNotifications', () => listAgentNotifications())

  ipcMain.removeHandler('agents:markNotificationsRead')
  ipcMain.handle('agents:markNotificationsRead', () => markAgentNotificationsRead())

  ipcMain.removeHandler('agents:listBriefing')
  ipcMain.handle('agents:listBriefing', (): BriefingItem[] => listRecentBriefingItems())

  ipcMain.removeHandler('agents:dismissBriefing')
  ipcMain.handle('agents:dismissBriefing', () => dismissBriefingItems())

  ipcMain.removeHandler('agents:listDrafts')
  ipcMain.handle('agents:listDrafts', () => listDrafts())

  ipcMain.removeHandler('agents:discardDraft')
  ipcMain.handle('agents:discardDraft', (_event, id: string) => {
    const draft = setDraftStatus(id, 'discarded')
    if (!draft) {
      throw new Error('Draft not found')
    }
    return draft
  })

  // Why: approving a draft is the only W2 path that writes an Asana comment, and it is IPC-only.
  ipcMain.removeHandler('agents:approveDraft')
  ipcMain.handle('agents:approveDraft', (_event, id: string) => approveDraftAndPost(id))

  ipcMain.removeHandler('agents:getPaused')
  ipcMain.handle('agents:getPaused', () => getAgentsPaused())

  ipcMain.removeHandler('agents:getExecutionState')
  ipcMain.handle('agents:getExecutionState', (): AgentsExecutionState => {
    const { paused, status, detail, filePath } = getAgentsControlState()
    return { paused, status, detail, filePath }
  })

  ipcMain.removeHandler('agents:setPaused')
  ipcMain.handle('agents:setPaused', (_event, paused: boolean) => setAgentsPaused(paused))

  ipcMain.removeHandler('agents:getPingStatus')
  ipcMain.handle('agents:getPingStatus', () => getPingStatus())

  ipcMain.removeHandler('agents:pickDirectory')
  ipcMain.handle(
    'agents:pickDirectory',
    async (_event, args: { defaultPath?: string }): Promise<string | null> => {
      const result = await dialog.showOpenDialog({
        defaultPath: args.defaultPath,
        // Why: agent cwd selection needs an existing folder grant; directory
        // creation can leave partial paths behind on macOS.
        properties: ['openDirectory']
      })
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    }
  )

  ipcMain.removeHandler('agents:listHarnesses')
  ipcMain.handle('agents:listHarnesses', () => listCustomHarnesses())

  // Why: validate at the IPC boundary too — a bad record must not persist when
  // the provider seam would only reject it later at launch.
  ipcMain.removeHandler('agents:saveHarness')
  ipcMain.handle(
    'agents:saveHarness',
    (_event, definition: CustomHarnessDefinition, originalId?: string | null) => {
      validateCustomHarnessDefinition(definition)
      return saveCustomHarness(definition, originalId ?? null)
    }
  )

  ipcMain.removeHandler('agents:deleteHarness')
  ipcMain.handle('agents:deleteHarness', (_event, id: string) => deleteCustomHarness(id))

  ipcMain.removeHandler('agents:runHarness')
  ipcMain.handle(
    'agents:runHarness',
    async (_event, args: { id: string; prompt: string; cwd?: string }) => {
      const provider = getCustomHarnessProvider(args.id)
      if (!provider) {
        throw new Error('Harness not found')
      }
      return provider.launch({ agentId: provider.agentId, prompt: args.prompt, cwd: args.cwd })
    }
  )

  ipcMain.removeHandler('agents:stopHarness')
  ipcMain.handle('agents:stopHarness', (_event, id: string) => stopCustomHarness(id))

  ipcMain.removeHandler('agents:harnessStatuses')
  ipcMain.handle('agents:harnessStatuses', () => listCustomHarnessStatuses())

  // Provider API keys stay in the main process: the renderer may ask whether one
  // is configured and may set or clear it, but can never read it back.
  ipcMain.removeHandler('agents:providerKeyStatus')
  ipcMain.handle('agents:providerKeyStatus', (_event, provider: ProviderKeyId) => ({
    configured: hasProviderApiKey(provider)
  }))

  ipcMain.removeHandler('agents:saveProviderKey')
  ipcMain.handle('agents:saveProviderKey', (_event, provider: ProviderKeyId, apiKey: string) => {
    saveProviderApiKey(provider, apiKey)
    return { configured: true }
  })

  ipcMain.removeHandler('agents:clearProviderKey')
  ipcMain.handle('agents:clearProviderKey', (_event, provider: ProviderKeyId) => {
    clearProviderApiKey(provider)
    return { configured: false }
  })
}
