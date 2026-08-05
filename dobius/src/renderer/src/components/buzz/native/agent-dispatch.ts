// Native port of dispatchMessageToDobiusAgents/awaitDobiusAgentRun from
// dobiusCommunications.ts. Calls window.api.agents.* directly (the same
// path Dobius's own Agents tab uses) instead of going through the
// webview-only communications RPC bridge.
import type { CustomAgent } from '../../../../../shared/agents'
import { sendAgentReply } from './messages'

export type AgentDirectory = {
  /** Maps a Communications pubkey back to the CustomAgent it belongs to. */
  byPubkey: Map<string, CustomAgent>
}

/** Loads every Dobius agent's Communications pubkey, generating one if an agent has none yet. */
export async function loadAgentDirectory(): Promise<AgentDirectory> {
  const agents = await window.api.agents.list()
  const byPubkey = new Map<string, CustomAgent>()
  await Promise.all(
    agents.map(async (agent) => {
      const identity = await window.api.communications.getAgentIdentity(agent.id)
      byPubkey.set(identity.pubkey.toLowerCase(), agent)
    })
  )
  return { byPubkey }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const RUN_POLL_INTERVAL_MS = 750
const RUN_POLL_TIMEOUT_MS = 2 * 60 * 60 * 1000

async function awaitAgentRun(agent: CustomAgent, runId: string): Promise<string> {
  const deadline = Date.now() + RUN_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const runs = await window.api.agents.listRuns()
    const run = runs.find((candidate) => candidate.id === runId)
    if (run && run.status !== 'running') {
      if (run.status === 'success') {return run.summary?.trim() || `${agent.name} completed the task.`}
      return `${agent.name} could not complete the task${run.summary ? `: ${run.summary}` : '.'}`
    }
    await delay(RUN_POLL_INTERVAL_MS)
  }
  return `${agent.name} is still working. Its run remains available in Dobius Agents.`
}

/**
 * If a DM's other participant is a Dobius agent, runs it with the message as
 * the prompt and posts the reply back into the channel once it finishes.
 * No-op (resolves immediately) when the participant isn't a known agent.
 */
export async function dispatchIfAgentDm(args: {
  channelId: string
  eventId: string
  content: string
  otherPubkeys: string[]
  directory: AgentDirectory
}): Promise<void> {
  const targets = args.otherPubkeys
    .map((pubkey) => args.directory.byPubkey.get(pubkey.toLowerCase()))
    .filter((agent): agent is CustomAgent => Boolean(agent))

  await Promise.all(
    targets.map(async (agent) => {
      try {
        const runId = await window.api.agents.run({ agentId: agent.id, prompt: args.content })
        const reply = await awaitAgentRun(agent, runId)
        await sendAgentReply(agent.id, args.channelId, args.eventId, reply)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await sendAgentReply(
          agent.id,
          args.channelId,
          args.eventId,
          `${agent.name} could not start: ${message}`
        ).catch(() => undefined)
      }
    })
  )
}

/** True while any target agent for this DM has an in-flight run. Powers the "working" spinner. */
export async function isAgentWorking(otherPubkeys: string[], directory: AgentDirectory): Promise<CustomAgent | null> {
  const targets = otherPubkeys
    .map((pubkey) => directory.byPubkey.get(pubkey.toLowerCase()))
    .filter((agent): agent is CustomAgent => Boolean(agent))
  if (targets.length === 0) {return null}

  const runs = await window.api.agents.listRuns()
  const workingAgentIds = new Set(runs.filter((run) => run.status === 'running').map((run) => run.agentId))
  return targets.find((agent) => workingAgentIds.has(agent.id)) ?? null
}
