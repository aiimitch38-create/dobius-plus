import type {
  AgentChannels,
  AgentHeartbeatSettings,
  AgentNotifyLevel,
  CustomAgent,
  CustomAgentInput
} from '../../../../shared/agents'

export const AGENT_MODELS = [
  'claude-opus-4-8',
  'claude-fable-5',
  'claude-sonnet-5',
  'claude-haiku-4-5'
]

// Real Codex CLI model ids, kept in sync with the ones this app's own
// Codex cost tracker prices (dobius/src/main/codex-usage/store.ts's
// MODEL_PRICING) — these are the values `codex --model <id>` actually
// accepts, not aspirational names.
export const CODEX_MODELS = [
  'gpt-5.5',
  'gpt-5.5-pro',
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.3',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5'
]

export const AGENT_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Bash',
  'Edit',
  'Write',
  'WebFetch',
  'WebSearch'
]

export const TRANSCRIPT_LIMIT = 500

export type AgentPageMode = 'run' | 'memory'

export type AgentDraft = Omit<
  CustomAgentInput,
  'heartbeat' | 'notify' | 'channels' | 'cwd' | 'skills'
> & {
  id?: string
  cwd: string
  skills: string[]
  heartbeat: AgentHeartbeatSettings
  notify: AgentNotifyLevel
  channels: AgentChannels
}

export function agentToDraft(agent: CustomAgent | null): AgentDraft {
  if (!agent) {
    return {
      name: '',
      description: '',
      icon: 'bot',
      color: '#b9bcc2',
      systemPrompt: '',
      engine: 'claude',
      model: AGENT_MODELS[0],
      allowedTools: ['Read', 'Grep', 'Glob'],
      skills: [],
      cwd: '',
      bypassPermissions: false,
      heartbeat: {
        enabled: false,
        frequency: 'daily',
        at: '08:00',
        quietStart: '23:00',
        quietEnd: '08:00',
        maxBudgetUsd: 0.5,
        maxTurns: 25
      },
      notify: 'digest + urgent',
      channels: { imessage: false }
    }
  }
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    icon: agent.icon,
    color: agent.color,
    systemPrompt: agent.systemPrompt,
    engine: agent.engine ?? 'claude',
    accountId: agent.accountId,
    model: agent.model,
    allowedTools: [...agent.allowedTools],
    skills: [...agent.skills],
    cwd: agent.cwd,
    bypassPermissions: agent.bypassPermissions,
    heartbeat: { ...agent.heartbeat },
    notify: agent.notify,
    channels: { ...agent.channels }
  }
}
