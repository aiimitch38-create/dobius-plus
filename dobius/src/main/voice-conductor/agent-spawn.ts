import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import type { CustomAgent } from '../../shared/agents'
import type { PrepareClaudeLaunch } from '../agents/agent-runner'
import type { WorkRegistry } from './types'

export type ConductorAgentSpawnerDeps = {
  listAgents(): CustomAgent[]
  getPrepareClaudeLaunch(): PrepareClaudeLaunch | null
  startAgentRun(args: {
    agentId: string
    prompt: string
    cwd: string
    prepareClaudeLaunch: PrepareClaudeLaunch
    options: {
      source: 'channel'
      spawnedBy: 'voice-conductor'
      resume: false
      onResult(message: { subtype: string; result?: string; errors?: string[] }): void
      onRunEnded(status: 'error' | 'cancelled', summary: string): void
    }
  }): Promise<string>
  notify(message: string): Promise<void>
  /** The conductor's work cap: a spawn holds one item until its run ends. */
  workRegistry: Pick<WorkRegistry, 'track' | 'markDone'>
}

/** The conductor already has its one allowed item running; retry after it ends. */
export class ConductorWorkCapacityError extends Error {
  readonly retryable = true
  constructor(message: string) {
    super(message)
    this.name = 'ConductorWorkCapacityError'
  }
}

export function isConductorWorkCapacityError(error: unknown): error is ConductorWorkCapacityError {
  return error instanceof ConductorWorkCapacityError
}

function budgetAwareFailure(message: { subtype: string; errors?: string[] }): string {
  if (message.subtype === 'error_max_budget_usd') {
    return 'stopped: it reached its spending limit for this run'
  }
  return (message.errors ?? ['Unknown error']).join('; ')
}

function findAgent(agentId: string, agents: readonly CustomAgent[]): CustomAgent | null {
  const query = agentId.trim().toLowerCase()
  return (
    agents.find((agent) => agent.id === agentId) ??
    agents.find((agent) => agent.name.toLowerCase() === query) ??
    agents.find((agent) => agent.name.toLowerCase().includes(query)) ??
    null
  )
}

function validateProjectPath(projectPath: string): string {
  const resolved = path.resolve(projectPath.trim())
  if (!projectPath.trim() || projectPath.includes('\u0000')) {
    throw new Error('projectPath required')
  }
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`project path does not exist: ${resolved}`)
  }
  return resolved
}

export function createConductorAgentSpawner(deps: ConductorAgentSpawnerDeps): {
  spawn(projectPath: string, agentId: string, prompt: string): Promise<{ runId: string }>
} {
  return {
    async spawn(projectPath, agentId, prompt) {
      const cwd = validateProjectPath(projectPath)
      const agent = findAgent(agentId, deps.listAgents())
      if (!agent) {
        throw new Error(`agent not found: ${agentId}`)
      }
      const trimmedPrompt = prompt.trim()
      if (!trimmedPrompt) {
        throw new Error('initialPrompt required')
      }
      const prepareClaudeLaunch = deps.getPrepareClaudeLaunch()
      if (!prepareClaudeLaunch) {
        throw new Error('Claude launch preparation is unavailable')
      }
      // Reserved synchronously before any await, so two concurrent spawns can't
      // both pass the check.
      const workId = `spawn-${randomUUID().slice(0, 8)}`
      const reservation = deps.workRegistry.track({
        workId,
        tabId: `agent:${agent.id}`,
        requestId: 'spawn',
        description: `${agent.name} in ${cwd}`,
        kind: 'spawn'
      })
      if (!reservation.ok) {
        throw new ConductorWorkCapacityError(reservation.error)
      }
      let released = false
      const release = (status: 'done' | 'error', summary: string): void => {
        if (released) {return}
        released = true
        try {
          deps.workRegistry.markDone(workId, summary.slice(0, 500), status)
        } catch (error) {
          // The item is already released in memory; only the save failed.
          console.warn('[voice-conductor] could not save the spawned run release:', error instanceof Error ? error.message : String(error))
        }
      }
      let reported = false
      const report = (message: string): void => {
        if (reported) {return}
        reported = true
        void deps.notify(message).catch((error) => {
          console.warn('[voice-conductor] failed to report spawned agent result:', error)
        })
      }
      let runId: string
      try {
        runId = await deps.startAgentRun({
          agentId: agent.id,
          prompt: trimmedPrompt,
          cwd,
          prepareClaudeLaunch,
          options: {
            source: 'channel',
            // Why: the worker inherits the conductor's messaging rails, so one
            // approved spawn can't install a self-approving helper.
            spawnedBy: 'voice-conductor',
            // Why: dobius-spawn promises a fresh worker; resuming the agent's prior
            // conversation could carry unrelated project context into this task.
            resume: false,
            onResult: (message) => {
              if (message.subtype === 'success') {
                release('done', message.result ?? 'Completed')
                report(`${agent.name} finished: ${(message.result ?? 'Completed').slice(0, 500)}`)
              } else {
                const failure = budgetAwareFailure(message)
                release('error', failure)
                report(`${agent.name} failed: ${failure.slice(0, 500)}`)
              }
            },
            onRunEnded: (status, summary) => {
              release('error', `${status}: ${summary}`)
              report(`${agent.name} ${status}: ${summary.slice(0, 500)}`)
            }
          }
        })
      } catch (error) {
        release('error', `did not start: ${error instanceof Error ? error.message : String(error)}`)
        throw error
      }
      return { runId }
    }
  }
}
