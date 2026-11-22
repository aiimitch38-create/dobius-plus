import type {
  OpenAiLiveErrorKind,
  OpenAiLiveFailure,
  OpenAiLiveSessionResult,
  OpenAiLiveTestResult
} from '../../shared/speech-types'
import { hasOpenAiSpeechApiKey, readOpenAiSpeechApiKey } from '../speech/openai-api-key-store'

/**
 * The one place the Live API address, model and request shape live.
 *
 * UNVERIFIED against a real call (no key was available when this was written).
 * The endpoint and model come from plans/research/REALTIME-VOICE-ADAM.md
 * sections 1.2 and 1.6. The design doc does not give the wire format, so the
 * multipart `sdp` + `session` body and the answer parsing below follow the
 * shape OpenAI uses for its Realtime WebRTC calls and must be checked on the
 * first live test.
 */
export const OPENAI_LIVE_API = {
  sessionsUrl: 'https://api.openai.com/v1/live/sessions',
  model: 'gpt-live-1.1',
  offerField: 'sdp',
  sessionField: 'session'
} as const

export const OPENAI_LIVE_REQUEST_TIMEOUT_MS = 15_000

// Why capped: the offer comes from the window, so main bounds what it relays.
const MAX_OFFER_SDP_CHARS = 100_000
const MAX_ANSWER_SDP_CHARS = 200_000
const MAX_ERROR_DETAIL_CHARS = 200

// Shaped like a real offer (one audio line, one data channel) but with no
// usable network candidates, so it can never carry a call.
const TEST_OFFER_SDP = [
  'v=0',
  'o=- 0 0 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=mid:0',
  'a=sendrecv',
  'a=rtcp-mux',
  'a=ice-ufrag:dobiustest',
  'a=ice-pwd:dobiusconnectiontestonly0000',
  'a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00',
  'a=setup:actpass',
  'a=rtpmap:111 opus/48000/2',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=mid:1',
  'a=sctp-port:5000',
  ''
].join('\r\n')

export type OpenAiLiveSessionOptions = {
  voice: string
  idleTimeoutSec: number
}

export type OpenAiLiveSessionDeps = {
  hasKey?: () => boolean
  readKey?: () => string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const ERROR_TEXT: Record<OpenAiLiveErrorKind, string> = {
  'invalid-offer': 'The app sent a call setup request that is not valid. Try again.',
  busy: 'A live voice connection is already being set up. Wait a moment and try again.',
  'no-key': 'No OpenAI API key is saved yet. Add one in Settings, Voice.',
  'key-unreadable':
    'The saved OpenAI API key could not be read on this Mac. Save the key again in Settings, Voice.',
  'bad-key':
    'OpenAI did not accept the saved API key. Check that it is a current key from the OpenAI developer platform.',
  'no-access':
    'This OpenAI account cannot use live voice yet. The key works, but the account has no access to the live voice model.',
  'no-billing':
    'This OpenAI account has no credit or billing set up for API use. A ChatGPT subscription does not include it.',
  'rate-limited': 'OpenAI is limiting requests right now. Wait a minute and try again.',
  network: 'Could not reach OpenAI. Check the internet connection and try again.',
  timeout: 'OpenAI took too long to answer. Try again.',
  server: 'OpenAI had a problem on its side. Try again in a few minutes.',
  rejected: 'OpenAI turned the request down.',
  'bad-response': 'OpenAI answered in a way this app did not understand.'
}

function fail(kind: OpenAiLiveErrorKind, detail = ''): OpenAiLiveFailure {
  return { ok: false, kind, error: detail ? `${ERROR_TEXT[kind]} ${detail}` : ERROR_TEXT[kind] }
}

// Why both passes: OpenAI echoes a masked key ("sk-abc***xyz") in some error
// text, and nothing key-shaped may reach the window or the log.
function scrubSecrets(text: string, apiKey: string): string {
  const withoutKey = apiKey ? text.split(apiKey).join('[hidden]') : text
  return withoutKey.replace(/sk-[A-Za-z0-9_\-*.]{3,}/g, '[hidden]')
}

export function isValidOfferSdp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_OFFER_SDP_CHARS) {
    return false
  }
  if (value.includes('\u0000')) {
    return false
  }
  return value.startsWith('v=0') && /(^|\n)m=/.test(value)
}

function isValidSessionOptions(options: OpenAiLiveSessionOptions): boolean {
  return (
    typeof options?.voice === 'string' &&
    /^[a-z][a-z0-9_-]{0,31}$/.test(options.voice) &&
    Number.isInteger(options.idleTimeoutSec) &&
    options.idleTimeoutSec >= 5 &&
    options.idleTimeoutSec <= 60
  )
}

function buildSessionConfig(options: OpenAiLiveSessionOptions): Record<string, unknown> {
  return {
    model: OPENAI_LIVE_API.model,
    voice: options.voice,
    // Why always: without standby the session bills the full active rate for
    // as long as it is open (design doc section 4.3, rule 6).
    wake_policy: { type: 'speech' },
    idle_timeout_s: options.idleTimeoutSec
  }
}

type ErrorBody = { message: string; code: string }

function parseErrorBody(raw: string): ErrorBody {
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: unknown; code?: unknown; type?: unknown }
    }
    const error = parsed?.error
    return {
      message: typeof error?.message === 'string' ? error.message : '',
      code: `${typeof error?.code === 'string' ? error.code : ''} ${
        typeof error?.type === 'string' ? error.type : ''
      }`
    }
  } catch {
    return { message: '', code: '' }
  }
}

function classifyHttpFailure(status: number, body: ErrorBody): OpenAiLiveErrorKind {
  if (status === 401) {
    return 'bad-key'
  }
  if (/insufficient_quota|billing/.test(body.code)) {
    return 'no-billing'
  }
  if (status === 403 || status === 404 || /model_not_found/.test(body.code)) {
    return 'no-access'
  }
  if (status === 429) {
    return 'rate-limited'
  }
  if (status >= 500) {
    return 'server'
  }
  return 'rejected'
}

function readStringField(source: unknown, key: string): string {
  const value =
    source && typeof source === 'object' ? (source as Record<string, unknown>)[key] : undefined
  return typeof value === 'string' ? value : ''
}

function readNestedField(source: unknown, key: string, nestedKey: string): string {
  const nested =
    source && typeof source === 'object' ? (source as Record<string, unknown>)[key] : undefined
  return readStringField(nested, nestedKey)
}

function parseSuccess(response: Response, raw: string): { answerSdp: string; sessionId: string } {
  const location = response.headers.get('location') ?? ''
  const idFromLocation = location.split('?')[0].split('/').filter(Boolean).pop() ?? ''
  if ((response.headers.get('content-type') ?? '').includes('json')) {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
    return {
      answerSdp:
        readStringField(parsed, 'sdp') ||
        readNestedField(parsed, 'answer', 'sdp') ||
        readStringField(parsed, 'answer'),
      sessionId:
        readStringField(parsed, 'id') ||
        readStringField(parsed, 'session_id') ||
        readNestedField(parsed, 'session', 'id') ||
        idFromLocation
    }
  }
  return { answerSdp: raw, sessionId: idFromLocation }
}

function logFailure(kind: OpenAiLiveErrorKind, status?: number): void {
  // Why so little: response bodies and thrown errors can carry key fragments.
  console.warn(
    `[jarvis-live] session create failed: ${kind}${status === undefined ? '' : ` (HTTP ${status})`}`
  )
}

/**
 * Creates one Live API session from the window's SDP offer.
 *
 * Why main: the API key is read here, at the moment of the call, and only the
 * SDP answer and the session id go back to the window.
 */
export async function createOpenAiLiveSession(
  offerSdp: unknown,
  options: OpenAiLiveSessionOptions,
  deps: OpenAiLiveSessionDeps = {}
): Promise<OpenAiLiveSessionResult> {
  if (!isValidOfferSdp(offerSdp) || !isValidSessionOptions(options)) {
    return fail('invalid-offer')
  }
  const hasKey = deps.hasKey ?? hasOpenAiSpeechApiKey
  const readKey = deps.readKey ?? readOpenAiSpeechApiKey
  if (!hasKey()) {
    return fail('no-key')
  }
  let apiKey: string
  try {
    apiKey = readKey().trim()
  } catch {
    logFailure('key-unreadable')
    return fail('key-unreadable')
  }
  if (!apiKey) {
    return fail('no-key')
  }

  const body = new FormData()
  body.set(OPENAI_LIVE_API.offerField, offerSdp)
  body.set(OPENAI_LIVE_API.sessionField, JSON.stringify(buildSessionConfig(options)))

  let response: Response
  let raw: string
  try {
    response = await (deps.fetchImpl ?? fetch)(OPENAI_LIVE_API.sessionsUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? OPENAI_LIVE_REQUEST_TIMEOUT_MS)
    })
    raw = await response.text()
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    const kind = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
    logFailure(kind)
    return fail(kind)
  }

  if (!response.ok) {
    const errorBody = parseErrorBody(raw)
    const kind = classifyHttpFailure(response.status, errorBody)
    logFailure(kind, response.status)
    // Why only for 'rejected': the other kinds already say everything useful,
    // and a 401 body repeats part of the key.
    const detail =
      kind === 'rejected'
        ? scrubSecrets(errorBody.message, apiKey).slice(0, MAX_ERROR_DETAIL_CHARS)
        : ''
    return fail(kind, detail)
  }

  const { answerSdp, sessionId } = parseSuccess(response, raw)
  if (
    !answerSdp.startsWith('v=') ||
    answerSdp.length > MAX_ANSWER_SDP_CHARS ||
    answerSdp.includes(apiKey)
  ) {
    logFailure('bad-response', response.status)
    return fail('bad-response')
  }
  return {
    ok: true,
    answerSdp,
    sessionId: sessionId && !sessionId.includes(apiKey) ? sessionId : null
  }
}

/**
 * Settings "Test connection": asks OpenAI for a session with a placeholder
 * offer that cannot carry audio, then reads the outcome.
 */
export async function testOpenAiLiveConnection(
  options: OpenAiLiveSessionOptions,
  deps: OpenAiLiveSessionDeps = {}
): Promise<OpenAiLiveTestResult> {
  const result = await createOpenAiLiveSession(TEST_OFFER_SDP, options, deps)
  if (result.ok) {
    return {
      ok: true,
      message: 'Connected. OpenAI accepted the key and opened a live voice session.'
    }
  }
  // Why this counts as a pass: OpenAI checks the key before it reads the
  // offer, so a complaint about the placeholder offer means the key got in.
  if (result.kind === 'rejected' && /\b(sdp|offer)\b/i.test(result.error)) {
    return {
      ok: true,
      message:
        'Connected. OpenAI accepted the key. The placeholder test call was turned down, as expected; a real call is the final check.'
    }
  }
  return result
}
