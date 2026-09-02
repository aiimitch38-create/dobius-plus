export const AGENT_COLORS = [
  '#b9bcc2',
  '#7aa2f7',
  '#62c073',
  '#f0b44c',
  '#e0645c',
  '#b48ead',
  '#56b6c2'
] as const

export const AGENT_ICONS = [
  'compass',
  'shield',
  'activity',
  'pen',
  'bot',
  'eye',
  'wrench',
  'book'
] as const

export type AgentColor = (typeof AGENT_COLORS)[number]
export type AgentIcon = (typeof AGENT_ICONS)[number]
export type AgentIdentityFileName = 'soul' | 'role' | 'playbook' | 'rules'
export type AgentCrewFileName = 'USER' | 'TOOLS'

export type AgentIdentityFiles = Record<AgentIdentityFileName, string>
export type AgentReadableFiles = AgentIdentityFiles & {
  brief: string
  memory: string
}
export type AgentCrewFiles = Record<AgentCrewFileName, string>

export type AgentHeartbeatFrequency = 'every10min' | 'hourly' | 'daily' | 'weekdays'

export type AgentHeartbeatSettings = {
  enabled: boolean
  frequency: AgentHeartbeatFrequency
  at: string
  quietStart: string
  quietEnd: string
  maxBudgetUsd: number
  maxTurns: number
}

export type AgentNotifyLevel = 'urgent only' | 'digest + urgent' | 'everything'

export type AgentChannels = {
  imessage: boolean
}

export type AgentEngine = 'claude' | 'codex'

export type CustomAgent = {
  id: string
  name: string
  description: string
  icon: AgentIcon
  color: AgentColor
  systemPrompt: string
  /** Missing on legacy records; execution treats it as Claude. */
  engine?: AgentEngine
  /** Null/absent follows the active managed account for the selected engine. */
  accountId?: string | null
  model: string
  allowedTools: string[]
  skills: string[]
  cwd: string
  bypassPermissions: boolean
  heartbeat: AgentHeartbeatSettings
  notify: AgentNotifyLevel
  channels: AgentChannels
  lastHeartbeatAt?: number
  lastSessionId?: string
  lastSessionCwd?: string
  createdAt: number
  updatedAt: number
}

export type AgentRunStatus = 'running' | 'success' | 'error' | 'cancelled'
export type AgentRunSource = 'manual' | 'heartbeat' | 'channel' | 'asana'

/**
 * A message the agent posted mid-run via the mcp__dobius__post_channel_message /
 * post_channel_screenshot tools. The Communications client polls the run and
 * publishes each item into the originating channel as the agent, live, so
 * progress and screenshots appear in chat before the run finishes.
 */
export type AgentRunOutboxItem = {
  id: string
  content: string
  /** data: URI (image) attached to the message, rendered inline in chat. */
  imageDataUrl?: string
  createdAt: number
}

export type AgentRun = {
  id: string
  agentId: string
  prompt: string
  source?: AgentRunSource
  startedAt: number
  endedAt?: number
  status: AgentRunStatus
  summary?: string
  numTurns?: number
  costUsd?: number
  outbox?: AgentRunOutboxItem[]
}

export type PendingAgentDecision = {
  id: string
  runId: string
  agentId: string
  toolName: string
  input: Record<string, unknown>
  title?: string
  displayName?: string
  description?: string
  cwd: string
  branch?: string
  createdAt: number
}

export type AgentDecisionResolutionAction =
  | 'approve'
  | 'approveEdited'
  | 'alwaysAllow'
  | 'deny'
  | 'respond'
  | 'bypassRun'

export type AgentDecisionResolution = {
  id: string
  action: AgentDecisionResolutionAction
  payload?: {
    input?: Record<string, unknown> | string
    text?: string
  }
}

export type AgentNotificationKind =
  | 'run-finished'
  | 'run-failed'
  | 'decision-pending'
  | 'decision-resolved'
  | 'briefing-now'

export type AgentNotificationEntry = {
  id: string
  ts: number
  agentId: string
  kind: AgentNotificationKind
  ok: boolean
  text: string
  decisionId?: string
}

export type AgentNotificationsSnapshot = {
  entries: AgentNotificationEntry[]
  lastReadTs: number
  unreadCount: number
}

export type BriefingItem = {
  id: string
  agentId: string
  ts: number
  urgency: 'digest' | 'now'
  summary: string
  demoted?: boolean
}

export type AgentDraftComment = {
  id: string
  agentId: string
  target: { kind: 'asana'; gid: string }
  body: string
  createdAt: number
  status: 'pending' | 'approved' | 'discarded'
}

export type HeartbeatVerdict = {
  important: boolean
  urgency: 'silent' | 'digest' | 'now'
  summary: string
}

export type TriageVerdict = {
  actionable: boolean
  skill: string
  summary: string
  needsClarification: boolean
}

// A user-defined external agent CLI (label + command + args + env) from the
// Communications Harness Catalog. Executable since the Phase 5 provider seam:
// CustomHarnessProvider spawns it. Env values are write-only — they reach the
// spawned process but must never come back through any read path or log.
export type CustomHarnessDefinition = {
  id: string
  label: string
  command: string
  args: string[]
  env: Record<string, string>
  installInstructionsUrl: string
  installHint: string
}

export type AgentProviderState = 'idle' | 'running' | 'finished' | 'failed'

export type AgentProviderStatusSnapshot = {
  providerId: string
  agentId: string
  label: string
  state: AgentProviderState
  lastRunId?: string
  /** Human-facing detail (last error/summary). Never env values or key material. */
  detail?: string
}

export type AgentProviderLaunchResult = {
  runId: string
  /** Nostr pubkey of the participant identity bound to this instance at launch. */
  identityPubkey: string
}

export type AgentRunEvent = {
  runId: string
  agentId: string
  ts: number
  kind: 'assistant-text' | 'tool-use' | 'tool-result' | 'system' | 'result' | 'error'
  text?: string
  toolName?: string
  detail?: string
}

export type CustomAgentInput = {
  name: string
  description?: string
  icon?: AgentIcon
  color?: AgentColor
  systemPrompt?: string
  engine?: AgentEngine
  accountId?: string | null
  model?: string
  allowedTools?: string[]
  skills?: string[]
  cwd?: string
  bypassPermissions?: boolean
  heartbeat?: AgentHeartbeatSettings
  notify?: AgentNotifyLevel
  channels?: AgentChannels
}

export type CustomAgentUpdate = Partial<Omit<CustomAgentInput, 'name'>> & {
  name?: string
}
