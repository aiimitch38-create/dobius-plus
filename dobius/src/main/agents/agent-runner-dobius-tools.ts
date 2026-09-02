import type { AgentRunSource } from '../../shared/agents'
import { buildDobiusToolServer } from './agent-tools/dobius-tool-server'

const DOBIUS_TOOL_ALLOW_RULE = 'mcp__dobius__*'

export function withDobiusToolAllowRule(tools: string[]): string[] {
  return tools.includes(DOBIUS_TOOL_ALLOW_RULE) ? tools : [...tools, DOBIUS_TOOL_ALLOW_RULE]
}

export function buildDobiusRunMcpServer(agentId: string, runId: string, source?: AgentRunSource) {
  // Channel runs get the live chat tools (post_channel_message / screenshot):
  // the Communications client polls the run's outbox and publishes each item
  // into the originating channel as the agent. Other sources have no channel
  // to deliver to, so the tools are not offered there.
  return buildDobiusToolServer({ agentId, runId, channelOutbox: source === 'channel' })
}
