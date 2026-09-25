import { DEFAULT_ADAM_ENDPOINT } from '../../shared/constants'
import type { JarvisAskResult } from '../../shared/speech-types'
import { resolveAdamEndpoint, resolveAdamToken } from '../adam-connection'

export const ADAM_CONVERSE_TIMEOUT_MS = 10_000
export const ADAM_UNREACHABLE_TEXT = 'ADAM is unreachable'
export const ADAM_NOT_INSTALLED_TEXT = 'ADAM is not installed on this Mac'

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

export type AskAdamArgs = {
  /** Settings voice.adamEndpoint from the caller's store. */
  settingsEndpoint: string | undefined
  utterance: string
  fetchFn?: typeof fetch
}

/**
 * Resolves the connection through the shared registry on every ask, so
 * Settings and token changes apply without a restart (#81). A missing ADAM
 * folder is a named state, not a request that can only fail (#118).
 */
export async function askAdam(args: AskAdamArgs): Promise<JarvisAskResult> {
  const tokenResult = await resolveAdamToken()
  if (tokenResult.token === undefined && tokenResult.state === 'not-installed') {
    return { kind: 'error', text: ADAM_NOT_INSTALLED_TEXT }
  }
  return converseWithAdam({
    endpoint: resolveAdamEndpoint(args.settingsEndpoint),
    // Why an empty token still asks: converse has always gone out without a
    // Bearer header when the token file is missing, and ADAM answers 401 itself.
    token: tokenResult.token ?? '',
    utterance: args.utterance,
    fetchFn: args.fetchFn
  })
}
