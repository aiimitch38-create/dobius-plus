import { createHash, randomUUID } from 'node:crypto'
import type { AdamDatabase } from '../db/database.js'
import type { ModelRoutingConfig } from './config.js'
import type { ModelRouteRequest } from './request.js'

type Fetch = typeof fetch

export type ModelRouteResult = {
  id: string
  backend: 'omniroute'
  requestedModel: string
  selectedModel?: string
  selectedProvider?: string
  decision?: string
  latencyMs: number
  costUsd?: number
  tokensIn?: number
  tokensOut?: number
  fallbackAttempts?: number
  upstreamRequestId?: string
  response: unknown
}

function headerNumber(headers: Headers, name: string): number | undefined {
  const value = headers.get(name)
  if (value === null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export class OmniRouteModelRouter {
  constructor(
    private readonly db: AdamDatabase,
    private readonly config: ModelRoutingConfig,
    private readonly fetchImpl: Fetch = fetch
  ) {}

  resolveModel(taskClass?: string, override?: string): string {
    const backend = this.config.backends.omniroute
    const model = override ?? backend.taskModels[taskClass ?? backend.defaultTaskClass]
      ?? backend.taskModels[backend.defaultTaskClass]
    if (!model) throw new Error('No OmniRoute model is configured for this task class')
    const allowed = backend.allowedModelPrefixes.some((prefix) => model === prefix || model.startsWith(`${prefix}/`))
    if (!allowed) throw new Error(`Model override is outside ADAM's OmniRoute allowlist: ${model}`)
    return model
  }

  async health(): Promise<{ ok: boolean; status?: number; error?: string }> {
    const backend = this.config.backends.omniroute
    if (!backend.enabled) return { ok: false, error: 'OmniRoute backend is disabled' }
    try {
      const response = await this.fetchImpl(`${backend.baseUrl}/api/health/ping`, {
        signal: AbortSignal.timeout(Math.min(backend.timeoutMs, 5_000))
      })
      return { ok: response.ok, status: response.status, ...(!response.ok ? { error: `HTTP ${response.status}` } : {}) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async route(request: ModelRouteRequest): Promise<ModelRouteResult> {
    const backend = this.config.backends.omniroute
    if (!backend.enabled) throw new Error('OmniRoute backend is disabled')
    const existing = this.db.prepare('SELECT * FROM model_routes WHERE request_key = ?').get(request.requestId) as Record<string, unknown> | undefined
    const requestDigest = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    if (existing) {
      if (existing.request_digest !== requestDigest) throw new Error('requestId was already used for a different model request')
      if (existing.state !== 'succeeded') throw new Error(`prior model route is ${String(existing.state)}`)
      return JSON.parse(String(existing.result)) as ModelRouteResult
    }

    const model = this.resolveModel(request.taskClass, request.model)
    const id = randomUUID()
    const startedAt = new Date().toISOString()
    this.db.prepare(`INSERT INTO model_routes
      (id, request_key, request_digest, backend, task_class, requested_model, state, started_at)
      VALUES (?, ?, ?, 'omniroute', ?, ?, 'running', ?)`)
      .run(id, request.requestId, requestDigest, request.taskClass ?? null, model, startedAt)

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'idempotency-key': request.requestId,
      'x-omniroute-no-memory': backend.noMemory ? 'true' : 'false',
      'x-omniroute-no-cache': backend.noCache ? 'true' : 'false'
    }
    const apiKey = process.env[backend.apiKeyEnv]
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    if (request.sessionId) headers['x-omniroute-session-id'] = request.sessionId

    const began = Date.now()
    try {
      const response = await this.fetchImpl(`${backend.baseUrl}/v1/chat/completions`, {
        method: 'POST', headers, signal: AbortSignal.timeout(backend.timeoutMs),
        body: JSON.stringify({
          model, messages: request.messages, stream: false,
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {})
        })
      })
      const raw = await response.text()
      if (!response.ok) throw new Error(`OmniRoute HTTP ${response.status}: ${raw.slice(0, 500)}`)
      const payload = JSON.parse(raw) as unknown
      const result: ModelRouteResult = {
        id, backend: 'omniroute', requestedModel: model,
        latencyMs: headerNumber(response.headers, 'x-omniroute-latency-ms') ?? Date.now() - began,
        ...(response.headers.get('x-omniroute-model') ? { selectedModel: response.headers.get('x-omniroute-model')! } : {}),
        ...(response.headers.get('x-omniroute-provider') ? { selectedProvider: response.headers.get('x-omniroute-provider')! } : {}),
        ...(response.headers.get('x-omniroute-decision') ? { decision: response.headers.get('x-omniroute-decision')! } : {}),
        ...(headerNumber(response.headers, 'x-omniroute-response-cost') !== undefined ? { costUsd: headerNumber(response.headers, 'x-omniroute-response-cost')! } : {}),
        ...(headerNumber(response.headers, 'x-omniroute-tokens-in') !== undefined ? { tokensIn: headerNumber(response.headers, 'x-omniroute-tokens-in')! } : {}),
        ...(headerNumber(response.headers, 'x-omniroute-tokens-out') !== undefined ? { tokensOut: headerNumber(response.headers, 'x-omniroute-tokens-out')! } : {}),
        ...(headerNumber(response.headers, 'x-omniroute-fallback-attempts') !== undefined ? { fallbackAttempts: headerNumber(response.headers, 'x-omniroute-fallback-attempts')! } : {}),
        ...(response.headers.get('x-omniroute-request-id') ? { upstreamRequestId: response.headers.get('x-omniroute-request-id')! } : {}),
        response: payload
      }
      this.db.prepare(`UPDATE model_routes SET state='succeeded', selected_model=?, selected_provider=?,
        decision=?, latency_ms=?, cost_usd=?, tokens_in=?, tokens_out=?, fallback_attempts=?,
        upstream_request_id=?, result=?, completed_at=? WHERE id=?`).run(
          result.selectedModel ?? null, result.selectedProvider ?? null, result.decision ?? null,
          result.latencyMs, result.costUsd ?? null, result.tokensIn ?? null, result.tokensOut ?? null,
          result.fallbackAttempts ?? null, result.upstreamRequestId ?? null, JSON.stringify(result),
          new Date().toISOString(), id
        )
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.db.prepare("UPDATE model_routes SET state='failed', error=?, latency_ms=?, completed_at=? WHERE id=?")
        .run(message, Date.now() - began, new Date().toISOString(), id)
      throw error
    }
  }
}
