import type {
  AgentProviderLaunchResult,
  AgentProviderStatusSnapshot,
  AgentRun
} from '../../../shared/agents'
// Imported from its defining module: default-claude-launch only imports this
// type for its own use and does not re-export it (TS2459).
import type { PrepareClaudeLaunch } from '../../agents/agent-runner'
import {
  CHANNEL_MAX_TURNS,
  chatChannelPrompt
} from '../../agents/agent-channel-voice'
import { getAgent } from '../../agents/agents-store'
import {
  listAgentRuns,
  startAgentRun,
  stopAgentRun
} from '../../agents/agent-runner'
import { subscribeToAgentRunEvents } from '../../agents/agent-run-events'
import type { AgentProvider, AgentProviderLaunch, AgentProviderStreamEvent } from './agent-provider'
import { bindProviderIdentity } from './agent-provider-identity'

/**
 * Behavior-preserving Claude path: everything here delegates to agent-runner's
 * startAgentRun (SDK query lifecycle, resume, decisions, hard rails stay
 * exactly where they were). The only seam-level additions are engine routing,
 * identity binding at launch, and the event subscription.
 */
export class ClaudeAgentSdkProvider implements AgentProvider {
  readonly providerId = 'claude-agent-sdk' as const

  constructor(
    readonly agentId: string,
    private readonly prepareClaudeLaunch: PrepareClaudeLaunch
  ) {}

  async launch(launch: AgentProviderLaunch): Promise<AgentProviderLaunchResult> {
    this.requireMatchingEngine()
    const identity = bindProviderIdentity(this.agentId)
    const runId = await startAgentRun({
      agentId: this.agentId,
      prompt: chatChannelPrompt(launch.prompt),
      cwd: launch.cwd,
      prepareClaudeLaunch: this.prepareClaudeLaunch,
      // Why: without an explicit cap a chat turn inherits agent-runner's
      // build-sized default of 100 turns (agent-runner.ts, maxTurns ?? 100).
      options: { source: 'channel', maxTurns: CHANNEL_MAX_TURNS }
    })
    return { runId, identityPubkey: identity.pubkey }
  }

  async send(text: string): Promise<void> {
    this.requireMatchingEngine()
    const prompt = text.trim()
    if (!prompt) {
      throw new Error('Prompt is required')
    }
    await startAgentRun({
      agentId: this.agentId,
      prompt: chatChannelPrompt(prompt),
      prepareClaudeLaunch: this.prepareClaudeLaunch,
      // Why: without an explicit cap a chat turn inherits agent-runner's
      // build-sized default of 100 turns (agent-runner.ts, maxTurns ?? 100).
      options: { source: 'channel', maxTurns: CHANNEL_MAX_TURNS }
    })
  }

  subscribe(listener: (event: AgentProviderStreamEvent) => void): () => void {
    return subscribeToAgentRunEvents((event) => {
      if (event.agentId === this.agentId) {
        listener({ kind: 'run-event', event })
      }
    })
  }

  async cancel(): Promise<void> {
    const run = this.lastRun()
    if (run && run.status === 'running') {
      await stopAgentRun(run.id)
    }
  }

  status(): AgentProviderStatusSnapshot {
    const run = this.lastRun()
    return {
      providerId: this.providerId,
      agentId: this.agentId,
      label: getAgent(this.agentId)?.name ?? this.agentId,
      state:
        run && run.status === 'running'
          ? 'running'
          : run?.status === 'error'
            ? 'failed'
            : run?.status === 'cancelled' || run?.status === 'success'
              ? 'finished'
              : 'idle',
      lastRunId: run?.id,
      detail: run?.summary
    }
  }

  private lastRun(): AgentRun | undefined {
    return listAgentRuns().find((run) => run.agentId === this.agentId)
  }

  private requireMatchingEngine(): void {
    const agent = getAgent(this.agentId)
    if (!agent) {
      throw new Error('Agent not found')
    }
    if ((agent.engine ?? 'claude') !== 'claude') {
      throw new Error(`Agent ${agent.name} is not a Claude agent`)
    }
  }
}
