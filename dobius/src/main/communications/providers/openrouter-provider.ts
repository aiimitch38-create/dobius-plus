import { randomUUID } from 'node:crypto'
import type {
  AgentProviderLaunchResult,
  AgentProviderStatusSnapshot,
  AgentRunEvent
} from '../../../shared/agents'
import type { AgentProvider, AgentProviderLaunch, AgentProviderStreamEvent } from './agent-provider'
import { bindProviderIdentity } from './agent-provider-identity'
import { readProviderApiKey } from './provider-api-key-store'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-sonnet-4.5'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type OpenRouterDeps = {
  fetch?: typeof globalThis.fetch
  readApiKey?: () => string
  model?: string
}

/**
 * Any-provider harness over OpenRouter's HTTP API.
 *
 * Unlike the Claude and Codex providers this is not runner-backed — there is no
 * local process to launch — so it owns its own turn loop. It keeps the
 * conversation in memory for the life of the instance so `send` continues the
 * thread rather than starting a new one.
 */
export class OpenRouterProvider implements AgentProvider {
  readonly providerId = 'custom-harness' as const

  private state: AgentProviderStatusSnapshot['state'] = 'idle'
  private detail: string | undefined
  private lastRunId: string | undefined
  private readonly listeners = new Set<(event: AgentProviderStreamEvent) => void>()
  private readonly messages: ChatMessage[] = []
  private controller: AbortController | null = null

  constructor(
    readonly agentId: string,
    private readonly label: string,
    private readonly deps: OpenRouterDeps = {}
  ) {}

  async launch(launch: AgentProviderLaunch): Promise<AgentProviderLaunchResult> {
    const identity = bindProviderIdentity(this.agentId)
    const runId = randomUUID()
    this.lastRunId = runId
    this.messages.length = 0
    await this.turn(launch.prompt)
    return { runId, identityPubkey: identity.pubkey }
  }

  async send(text: string): Promise<void> {
    const prompt = text.trim()
    if (!prompt) {
      throw new Error('Prompt is required')
    }
    await this.turn(prompt)
  }

  subscribe(listener: (event: AgentProviderStreamEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async cancel(): Promise<void> {
    this.controller?.abort()
    this.controller = null
    if (this.state === 'running') {
      this.state = 'finished'
      this.detail = 'stopped by user'
      this.emitRunEvent({ kind: 'system', detail: this.detail })
      this.emit({ kind: 'status', state: this.status() })
    }
  }

  status(): AgentProviderStatusSnapshot {
    return {
      providerId: this.providerId,
      agentId: this.agentId,
      label: this.label,
      state: this.state,
      ...(this.lastRunId ? { lastRunId: this.lastRunId } : {}),
      // Never the key or any header — only a human-facing summary.
      ...(this.detail ? { detail: this.detail } : {})
    }
  }

  private async turn(prompt: string): Promise<void> {
    const doFetch = this.deps.fetch ?? globalThis.fetch
    const apiKey = (this.deps.readApiKey ?? (() => readProviderApiKey('openrouter')))()

    this.messages.push({ role: 'user', content: prompt })
    this.state = 'running'
    this.detail = undefined
    this.emit({ kind: 'status', state: this.status() })

    const controller = new AbortController()
    this.controller = controller
    try {
      const response = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.deps.model ?? DEFAULT_OPENROUTER_MODEL,
          messages: this.messages
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        // Body may echo the request; report status only so a key cannot surface.
        throw new Error(`OpenRouter request failed (HTTP ${response.status})`)
      }

      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[]
      }
      const reply = payload.choices?.[0]?.message?.content?.trim()
      if (!reply) {
        throw new Error('OpenRouter returned no content')
      }

      this.messages.push({ role: 'assistant', content: reply })
      this.emitRunEvent({ kind: 'system', detail: reply })
      this.state = 'finished'
      this.detail = `${this.label} replied`
      this.emitRunEvent({ kind: 'result', text: reply })
    } catch (error) {
      this.state = 'failed'
      this.detail = error instanceof Error ? error.message : 'OpenRouter request failed'
      this.emitRunEvent({ kind: 'error', text: this.detail })
    } finally {
      if (this.controller === controller) {
        this.controller = null
      }
      this.emit({ kind: 'status', state: this.status() })
    }
  }

  private emitRunEvent(event: Omit<AgentRunEvent, 'runId' | 'agentId' | 'ts'>): void {
    if (!this.lastRunId) {
      return
    }
    this.emit({
      kind: 'run-event',
      event: {
        runId: this.lastRunId,
        agentId: this.agentId,
        ts: Date.now(),
        ...event
      }
    })
  }

  private emit(event: AgentProviderStreamEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
