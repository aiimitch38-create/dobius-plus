import { z } from 'zod'
import type { CustomAgent } from '../../../../shared/agents'
import {
  createAgent,
  getAgent,
  listAgents,
  removeAgent,
  updateAgent
} from '../../../agents/agents-store'
import { listAgentRuns, startAgentRun } from '../../../agents/agent-runner'
import { getAgentRunOutbox } from '../../../agents/agent-runs-store'
import { getDefaultPrepareClaudeLaunch } from '../../../agents/default-claude-launch'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalPlainString, OptionalString, requiredString } from '../schemas'

const OptionalStringArray = z.array(z.string()).optional()

const AgentId = z.object({
  id: requiredString('Missing agent id')
})

// Why: icon/color/heartbeat/notify/channels/bypassPermissions stay UI-only —
// bypass in particular weakens the permission gate, so enabling it requires
// the in-app Agents tab, not a headless CLI call.
const AgentCreate = z.object({
  name: requiredString('Missing agent name'),
  description: OptionalPlainString,
  systemPrompt: OptionalPlainString,
  engine: z.enum(['claude', 'codex']).optional(),
  accountId: z.string().trim().min(1).nullable().optional(),
  model: OptionalString,
  allowedTools: OptionalStringArray,
  skills: OptionalStringArray,
  cwd: OptionalPlainString
})

const AgentUpdateFields = z.object({
  name: OptionalString,
  description: OptionalPlainString,
  systemPrompt: OptionalPlainString,
  engine: z.enum(['claude', 'codex']).optional(),
  accountId: z.string().trim().min(1).nullable().optional(),
  model: OptionalString,
  allowedTools: OptionalStringArray,
  skills: OptionalStringArray,
  cwd: OptionalPlainString
})

const AgentUpdate = z.object({
  id: requiredString('Missing agent id'),
  updates: AgentUpdateFields
})

const AgentRunStart = z.object({
  id: requiredString('Missing agent id'),
  prompt: requiredString('Missing agent prompt'),
  source: z.enum(['manual', 'heartbeat', 'channel', 'asana']).optional()
})

const AgentRunsQuery = z.object({
  agentId: OptionalString
})

const AgentRunOutboxQuery = z.object({
  runId: requiredString('Missing run id'),
  afterId: OptionalString
})

function showAgent(id: string): CustomAgent {
  const agent = getAgent(id)
  if (!agent) {
    throw new Error(`Agent not found: ${id}`)
  }
  return agent
}

export const CUSTOM_AGENT_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'agent.list',
    params: null,
    handler: () => ({ agents: listAgents() })
  }),
  defineMethod({
    name: 'agent.show',
    params: AgentId,
    handler: (params) => ({ agent: showAgent(params.id) })
  }),
  defineMethod({
    name: 'agent.create',
    params: AgentCreate,
    handler: (params) => {
      const agents = createAgent(params)
      // Why: createAgent appends the new record and returns the full roster,
      // so the last entry is the agent that was just created. Assert it —
      // returning { agent: undefined } serializes to {} and callers reading
      // result.agent.<field> crash with "undefined is not an object".
      const agent = agents.at(-1)
      if (!agent) {
        throw new Error('Agent creation did not persist a record')
      }
      return { agent }
    }
  }),
  defineMethod({
    name: 'agent.update',
    params: AgentUpdate,
    handler: (params) => {
      const agents = updateAgent(params.id, params.updates)
      const agent = agents.find((candidate) => candidate.id === params.id)
      // Same contract as agent.create: never hand back { agent: undefined }.
      if (!agent) {
        throw new Error(`Agent not found after update: ${params.id}`)
      }
      return { agent }
    }
  }),
  defineMethod({
    name: 'agent.delete',
    params: AgentId,
    handler: (params) => {
      showAgent(params.id)
      removeAgent(params.id)
      return { removed: true, id: params.id }
    }
  }),
  defineMethod({
    name: 'agent.run',
    params: AgentRunStart,
    handler: async (params) => {
      const prepareClaudeLaunch = getDefaultPrepareClaudeLaunch()
      if (!prepareClaudeLaunch) {
        throw new Error('Agent runs require the Dobius+ app to be running')
      }
      const runId = await startAgentRun({
        agentId: params.id,
        prompt: params.prompt,
        prepareClaudeLaunch,
        // Channel runs are headless — nobody sits at the agent panel to click
        // tool approvals, so undecided prompts would hang the conversation.
        // 'dontAsk' lets the agent's allowlisted tools run and denies the rest.
        options: params.source
          ? {
              source: params.source,
              ...(params.source === 'channel' ? { permissionMode: 'dontAsk' as const } : {})
            }
          : undefined
      })
      return { runId }
    }
  }),
  defineMethod({
    name: 'agent.runs',
    params: AgentRunsQuery,
    handler: (params) => ({
      runs: params.agentId
        ? listAgentRuns().filter((run) => run.agentId === params.agentId)
        : listAgentRuns()
    })
  }),
  defineMethod({
    name: 'agent.runOutbox',
    params: AgentRunOutboxQuery,
    // Separate from agent.runs on purpose: outbox items carry base64 images,
    // and shipping them inside the 750ms runs poll re-serialized megabytes per
    // tick. This returns only items the caller has not seen yet.
    handler: (params) => ({
      items: getAgentRunOutbox(params.runId, params.afterId ?? null)
    })
  })
]
