import { CHANNEL_AGENT_BASELINE_TOOLS, type AgentRunSource } from '../../shared/agents'
import type { AsanaLane } from '../../shared/asana'
import { buildDobiusToolServer } from './agent-tools/dobius-tool-server'
import type { DobiusToolName } from './agent-tools/dobius-tool-handlers'

/**
 * Which tool set a run gets. Defaults to the run's source; the Voice Conductor
 * records its runs as 'channel' but must not inherit the channel profile.
 */
export type AgentRunProfileId = AgentRunSource | 'voice-conductor'

export type AgentRunProfile = {
  id: AgentRunProfileId
  /** The mcp__dobius__ tools this run's server registers and allows. */
  dobiusTools: readonly DobiusToolName[]
  /** Trusted Asana lane from the caller; only a 'build' lane may dispatch builds. */
  buildLane?: AsanaLane
  /** Channel runs get CHANNEL_AGENT_BASELINE_TOOLS unioned into their allowlist. */
  channelBaseline: boolean
}

const DOBIUS_TOOL_PREFIX = 'mcp__dobius__'

const CREW_TOOLS: readonly DobiusToolName[] = [
  'asana_draft_comment',
  'read_knowledge',
  'list_crew',
  'crew_status',
  'file_briefing_item'
]

// Why: every Claude run used to get mcp__dobius__* — including dispatch_build,
// which launches an unbudgeted terminal agent. Only Asana triage on the build
// lane may dispatch; everything else gets the crew tools it actually uses.
const PROFILE_DOBIUS_TOOLS: Record<AgentRunProfileId, readonly DobiusToolName[]> = {
  manual: CREW_TOOLS,
  heartbeat: CREW_TOOLS,
  channel: ['post_channel_message', 'post_channel_screenshot', 'create_board_task', ...CREW_TOOLS],
  asana: ['file_briefing_item', 'asana_draft_comment', 'read_knowledge'],
  // The conductor drives Dobius+ through its dobius-* CLI commands, not MCP.
  'voice-conductor': []
}

export function resolveAgentRunProfile(args: {
  source: AgentRunSource
  profile?: AgentRunProfileId
  asanaLane?: AsanaLane
}): AgentRunProfile {
  const id = args.profile ?? args.source
  const buildLane = id === 'asana' ? args.asanaLane : undefined
  const dobiusTools =
    buildLane === 'build'
      ? [...PROFILE_DOBIUS_TOOLS[id], 'dispatch_build' as const]
      : PROFILE_DOBIUS_TOOLS[id]
  return { id, dobiusTools, buildLane, channelBaseline: id === 'channel' }
}

/**
 * Permission allowlist for the run: the caller's/agent's tools (any dobius
 * entry, including a wildcard, replaced by the profile's explicit names), plus
 * the channel baseline when the profile carries it.
 */
export function buildProfileAllowedTools(
  profile: AgentRunProfile,
  configuredTools: readonly string[]
): string[] {
  const nonDobius = configuredTools.filter((tool) => !tool.startsWith(DOBIUS_TOOL_PREFIX))
  const base = profile.channelBaseline ? [...nonDobius, ...CHANNEL_AGENT_BASELINE_TOOLS] : nonDobius
  return [
    ...new Set([...base, ...profile.dobiusTools.map((name) => `${DOBIUS_TOOL_PREFIX}${name}`)])
  ]
}

/**
 * The SDK `tools` option is the set of AVAILABLE built-in tools; `allowedTools`
 * only auto-approves. An omitted explicit list keeps the SDK default set; an
 * explicit list (even an empty one) exposes exactly its built-in tool names —
 * MCP entries and permission-rule suffixes like `Bash(git:*)` are not tool names.
 */
export function builtInToolsFor(
  explicitTools: readonly string[] | undefined
): string[] | undefined {
  if (explicitTools === undefined) {
    return undefined
  }
  const names = explicitTools
    .filter((tool) => !tool.startsWith('mcp__'))
    .map((tool) => tool.replace(/\(.*\)$/, '').trim())
    .filter((tool) => tool.length > 0)
  return [...new Set(names)]
}

export function buildDobiusRunMcpServer(agentId: string, runId: string, profile: AgentRunProfile) {
  // Channel runs get the live chat tools (post_channel_message / screenshot):
  // the Communications client polls the run's outbox and publishes each item
  // into the originating channel as the agent. Other profiles have no channel
  // to deliver to, so the tools are not offered there.
  return buildDobiusToolServer({
    agentId,
    runId,
    tools: profile.dobiusTools,
    buildLane: profile.buildLane
  })
}
