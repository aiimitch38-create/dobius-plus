import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_ADAM_ENDPOINT } from '../../shared/constants'
import type { JarvisAskResult } from '../../shared/speech-types'

export const ADAM_CONVERSE_TIMEOUT_MS = 10_000
export const ADAM_UNREACHABLE_TEXT = 'ADAM is unreachable'

/**
 * Token path lives outside the settings surface by design: it is machine-local
 * provisioning for the ADAM sidecar, not something the renderer should edit.
 * DOBIUS_ADAM_TOKEN_PATH exists so tests and non-default machines can redirect it.
 */
export function adamServiceTokenPath(): string {
  return (
    process.env.DOBIUS_ADAM_TOKEN_PATH ||
    join(homedir(), 'dobius', 'projects', 'ADAM', 'service', 'data', 'service-token')
  )
}

type TokenReader = (path: string) => string
const defaultTokenReader: TokenReader = (path) => readFileSync(path, 'utf-8')

let cachedToken: string | null = null

/** Reads once per process; later calls reuse the cache so ask() stays cheap. */
export function loadAdamServiceToken(reader: TokenReader = defaultTokenReader): string {
  if (cachedToken !== null) {
    return cachedToken
  }
  try {
    cachedToken = reader(adamServiceTokenPath()).trim()
  } catch {
    // Unreadable/missing token still yields an empty Bearer value; the request
    // then fails like any other unreachable case instead of throwing here.
    cachedToken = ''
  }
  return cachedToken
}

export function resetAdamServiceTokenCacheForTests(): void {
  cachedToken = null
}

export function parseAdamConverseResponse(payload: unknown): JarvisAskResult {
  if (!payload || typeof payload !== 'object') {
    return { kind: 'error', text: 'ADAM sent an unreadable response' }
  }
  const body = payload as { ok?: unknown; result?: unknown }
  if (body.ok !== true || !body.result || typeof body.result !== 'object') {
    return { kind: 'error', text: 'ADAM sent an unreadable response' }
  }
  const result = body.result as { kind?: unknown; text?: unknown; jobId?: unknown }
  if (typeof result.text !== 'string') {
    return { kind: 'error', text: 'ADAM sent an unreadable response' }
  }
  if (result.kind === 'job') {
    return {
      kind: 'job',
      text: result.text,
      ...(typeof result.jobId === 'string' ? { jobId: result.jobId } : {})
    }
  }
  if (result.kind === 'answer') {
    return { kind: 'answer', text: result.text }
  }
  return { kind: 'error', text: 'ADAM sent an unreadable response' }
}

export type ConverseAdamArgs = {
  endpoint?: string
  token: string
  utterance: string
  fetchFn?: typeof fetch
  timeoutMs?: number
}

/**
 * POSTs one utterance to ADAM's local /v1/converse endpoint. Every transport
 * failure (network, HTTP status, timeout) collapses into a single error result
 * so callers never see a throw from this path.
 */
export async function converseWithAdam(args: ConverseAdamArgs): Promise<JarvisAskResult> {
  const base = (args.endpoint ?? DEFAULT_ADAM_ENDPOINT).replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? ADAM_CONVERSE_TIMEOUT_MS)
  timer.unref?.()
  try {
    const response = await (args.fetchFn ?? fetch)(`${base}/v1/converse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(args.token ? { Authorization: `Bearer ${args.token}` } : {})
      },
      body: JSON.stringify({ utterance: args.utterance }),
      signal: controller.signal
    })
    if (!response.ok) {
      return { kind: 'error', text: ADAM_UNREACHABLE_TEXT }
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { kind: 'error', text: 'ADAM sent an unreadable response' }
    }
    return parseAdamConverseResponse(payload)
  } catch {
    return { kind: 'error', text: ADAM_UNREACHABLE_TEXT }
  }
}
