import type {
  AgentProviderLaunchResult,
  AgentProviderStatusSnapshot,
  AgentRunEvent
} from '../../../shared/agents'

export type AgentProviderId = 'claude-agent-sdk' | 'codex-cli' | 'custom-harness'

export type AgentProviderLaunch = {
  agentId: string
  prompt: string
  cwd?: string
}

export type AgentProviderStreamEvent =
  | { kind: 'run-event'; event: AgentRunEvent }
  | { kind: 'status'; state: AgentProviderStatusSnapshot }

/**
 * The Phase 5 provider seam (plans/TASK-COMMS-MASTER-PLAN.md): one shape for
 * launching and talking to any agent harness. Runner-backed implementations
 * delegate to src/main/agents/agent-runner.ts — they must never reimplement
 * launch mechanics.
 */
export type AgentProvider = {
  readonly providerId: AgentProviderId
  readonly agentId: string
  /** Starts a run for the bound agent and binds its Nostr participant identity. */
  launch(launch: AgentProviderLaunch): Promise<AgentProviderLaunchResult>
  /** Delivers a follow-up user turn to the launched instance. */
  send(text: string): Promise<void>
  /** Streams run events until the returned unsubscribe is called. */
  subscribe(listener: (event: AgentProviderStreamEvent) => void): () => void
  cancel(): Promise<void>
  status(): AgentProviderStatusSnapshot
}
