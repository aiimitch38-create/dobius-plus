// Lifecycle coordinator for the Voice Conductor. Owns the singleton engine +
// leaf modules and starts/stops them in step with the `voice.conductorEnabled`
// setting. Wired from src/main/index.ts at boot and on every settings change.

import path from 'node:path'
import { app } from 'electron'
import type { GlobalSettings } from '../../shared/types'
import type { DobiusCliDispatcher } from '../dobius-cli/dispatch-server'
import { listAgents } from '../agents/agents-store'
import { startAgentRun } from '../agents/agent-runner'
import { getDefaultPrepareClaudeLaunch } from '../agents/default-claude-launch'
import { createVoiceConductor } from './conductor'
import { createIMessageBridge } from './imessage-bridge'
import { conductorImessageHandle, createSettingsLaneAsanaQueue } from './conductor-settings'
import {
  startConductorCliServer,
  stopConductorCliServer,
  type ConductorCliDeps,
  type ConductorTerminalDispatch
} from './cli-server'
import { createLeadTabStore } from './lead-tab-store'
import { createConductorAgentSpawner } from './agent-spawn'
import { createPersistentWorkRegistry } from './persistent-work-registry'
import type { WorkRegistry } from './types'

const conductor = createVoiceConductor()
let started = false
let leadTabStore: ReturnType<typeof createLeadTabStore> | null = null

// Why once per process: a spawned worker outlives a conductor off/on toggle. A
// second registry would reload the file, mark that live worker "interrupted"
// (freeing the cap for a second paid run), and the old one would later save
// stale items over the file.
let workRegistry: WorkRegistry | null = null

function getWorkRegistry(): WorkRegistry {
  workRegistry ??= createPersistentWorkRegistry(
    path.join(app.getPath('userData'), 'voice-conductor-work.json')
  )
  return workRegistry
}

function getLeadTabStore(): ReturnType<typeof createLeadTabStore> {
  leadTabStore ??= createLeadTabStore(path.join(app.getPath('userData'), 'voice-conductor-tabs.json'))
  return leadTabStore
}

/**
 * Back the CLI dispatch verbs with v2's runtime terminal API. Custom-agent
 * spawning goes through the conductor agent spawner (v2 agent runner).
 */
function buildTerminalDispatch(
  runtime: DobiusCliDispatcher,
  imessage: ReturnType<typeof createIMessageBridge>,
  workRegistry: WorkRegistry
): ConductorTerminalDispatch {
  const tabs = getLeadTabStore()
  const agentSpawner = createConductorAgentSpawner({
    listAgents,
    getPrepareClaudeLaunch: getDefaultPrepareClaudeLaunch,
    startAgentRun,
    notify: (message) => imessage.send(message),
    workRegistry
  })
  return {
    resolveActiveTab: () => runtime.resolveActiveTerminal(),
    sendToTab: async (tabId, text) => {
      await runtime.sendTerminal(tabId, { text, enter: true })
      return { sent: text.length }
    },
    listTabs: async () => {
      const { terminals } = await runtime.listTerminals()
      return terminals.map((t) => ({
        id: t.handle,
        title: t.title ?? '',
        projectPath: t.worktreePath ?? '',
        cwd: t.worktreePath ?? ''
      }))
    },
    spawnAgent: (projectPath, agentId, prompt) => agentSpawner.spawn(projectPath, agentId, prompt),
    getLeadTab: async (projectPath) => {
      const savedTabId = tabs.get(projectPath)
      if (!savedTabId) {
        return null
      }
      const normalizedProjectPath = path.resolve(projectPath)
      const liveTabs = await runtime.listTerminals()
      const isLiveForProject = liveTabs.terminals.some(
        (terminal) =>
          terminal.handle === savedTabId &&
          terminal.worktreePath !== undefined &&
          path.resolve(terminal.worktreePath) === normalizedProjectPath
      )
      if (!isLiveForProject) {
        tabs.set(projectPath, null)
        return null
      }
      return savedTabId
    },
    setLeadTab: async (projectPath, tabId) => {
      if (tabId !== null) {
        const normalizedProjectPath = path.resolve(projectPath)
        const liveTabs = await runtime.listTerminals()
        const isLiveForProject = liveTabs.terminals.some(
          (terminal) =>
            terminal.handle === tabId &&
            terminal.worktreePath !== undefined &&
            path.resolve(terminal.worktreePath) === normalizedProjectPath
        )
        if (!isLiveForProject) {
          throw new Error('lead tab must be a live terminal in the selected project')
        }
      }
      tabs.set(projectPath, tabId)
    }
  }
}

/**
 * Reconcile the running conductor with the current setting. Idempotent: safe to
 * call at boot and on every settings change. The iMessage handle and Asana
 * lanes are read from Settings at each use, so they need no restart.
 */
export function syncVoiceConductorFromSettings(
  settings: GlobalSettings,
  runtime: DobiusCliDispatcher
): void {
  const enabled = settings.voice?.conductorEnabled ?? false
  if (enabled && !started) {
    const imessage = createIMessageBridge({ resolveHandle: conductorImessageHandle })
    const unavailable = imessage.unavailableReason()
    if (unavailable) {
      console.warn(`[voice-conductor] iMessage approvals will be denied: ${unavailable}`)
    }
    const workRegistry = getWorkRegistry()
    const deps: ConductorCliDeps = {
      conductor,
      workRegistry,
      imessage,
      asana: createSettingsLaneAsanaQueue(),
      terminals: buildTerminalDispatch(runtime, imessage, workRegistry)
    }
    started = true // reserve up front so a concurrent sync can't double-start
    startConductorCliServer(deps)
    void conductor.start().catch((err) => {
      // Fail-safe: tear down so a later toggle / settings change retries cleanly
      // instead of leaving the CLI server up with a dead conductor.
      console.error('[voice-conductor] start failed:', err)
      stopConductorCliServer()
      started = false
    })
  } else if (!enabled && started) {
    started = false
    stopConductorCliServer()
    void conductor.stop().catch((err) => {
      console.error('[voice-conductor] stop failed:', err)
    })
  }
}

/** Feed a transcript to the running conductor (mobile /voice/intent analog). */
export function postVoiceConductorTranscript(input: {
  transcript: string
  requestId: string
}): Promise<void> {
  if (!started || !conductor.isRunning()) {
    return Promise.reject(new Error('Voice Conductor is disabled'))
  }
  return conductor.postTranscript(input)
}

/** Read the conductor's reply for a request id, for the /voice/reply poller. */
export function getVoiceConductorReply(
  requestId: string,
  sinceTs?: number
): { message: string; ts: number } | null {
  return conductor.getReply(requestId, sinceTs)
}
