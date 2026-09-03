import type {
  AgentProviderLaunchResult,
  AgentProviderStatusSnapshot,
  AgentRun
} from '../../../shared/agents'
import type { PrepareCodexLaunch } from '../../agents/default-codex-launch'
import { getAgent } from '../../agents/agents-store'
import { listAgentRuns, startAgentRun, stopAgentRun } from '../../agents/agent-runner'
import { subscribeToAgentRunEvents } from '../../agents/agent-run-events'
import type { AgentProvider, AgentProviderLaunch, AgentProviderStreamEvent } from './agent-provider'
import { bindProviderIdentity } from './agent-provider-identity'

/**
 * Behavior-preserving Codex path: delegates to agent-runner's startAgentRun
 * (which routes engine==='codex' agents through startCodexRun). No launch
 * mechanics live here — only engine routing, identity binding, and streaming.
 */
export class CodexCliProvider implements AgentProvider {
  readonly providerId = 'codex-cli' as const

  constructor(
    readonly agentId: string,
    private readonly prepareCodexLaunch?: PrepareCodexLaunch
  ) {}

  async launch(launch: AgentProviderLaunch): Promise<AgentProviderLaunchResult> {
    this.requireMatchingEngine()
    const identity = bindProviderIdentity(this.agentId)
    const runId = await startAgentRun({
      agentId: this.agentId,
      prompt: launch.prompt,
      cwd: launch.cwd,
      prepareClaudeLaunch: async () => {
        throw new Error('Codex runs do not use Claude account preparation')
      },
      prepareCodexLaunch: this.prepareCodexLaunch,
      options: { source: 'channel' }
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
      prompt,
      prepareClaudeLaunch: async () => {
        throw new Error('Codex runs do not use Claude account preparation')
      },
      prepareCodexLaunch: this.prepareCodexLaunch,
      options: { source: 'channel' }
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
    if (agent.engine !== 'codex') {
      throw new Error(`Agent ${agent.name} is not a Codex agent`)
    }
  }
}
