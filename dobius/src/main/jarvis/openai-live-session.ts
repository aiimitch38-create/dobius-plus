import type {
  OpenAiLiveErrorKind,
  OpenAiLiveFailure,
  OpenAiLiveSessionResult
} from '../../shared/speech-types'
import { hasOpenAiSpeechApiKey, readOpenAiSpeechApiKey } from '../speech/openai-api-key-store'

/**
 * The one place the Live API address, model and request shape live.
 *
 * Wire format from the Live API reference (developers.openai.com/api/reference/
 * resources/live/methods/create), checked 2026-11-22 after the first real call
 * was refused for not being JSON: a JSON body of `session` + `transport`
 * ({ type: 'webrtc', sdp }), answered by 201 with session.id and transport.sdp.
 */
export const OPENAI_LIVE_API = {
  sessionsUrl: 'https://api.openai.com/v1/live/sessions',
  model: 'gpt-live-1.1'
} as const

export const OPENAI_LIVE_REQUEST_TIMEOUT_MS = 15_000

// Why capped: the offer comes from the window, so main bounds what it relays.
const MAX_OFFER_SDP_CHARS = 100_000
const MAX_ANSWER_SDP_CHARS = 200_000
const MAX_ERROR_DETAIL_CHARS = 200

export type OpenAiLiveSessionOptions = {
  voice: string
  idleTimeoutSec: number
  /** ADAM's voice instructions (live-voice-prompt.ts), built in main. */
  instructions?: string
}

// Why: the Live API takes up to 16,384 tokens of instructions; main builds
// them, so this is a backstop against a runaway seed, not a user limit.
const MAX_INSTRUCTIONS_CHARS = 40_000

export type OpenAiLiveSessionDeps = {
  hasKey?: () => boolean
  readKey?: () => string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Aborts an in-flight create, for example when the requesting window closes. */
  signal?: AbortSignal
}

const ERROR_TEXT: Record<OpenAiLiveErrorKind, string> = {
  'invalid-offer': 'The app sent a call setup request that is not valid. Try again.',
  busy: 'A live voice connection is already being set up. Wait a moment and try again.',
  'not-allowed': 'Live voice can only be started from the main Dobius+ window.',
  'not-ready':
    'OpenAI Live is not switched on. Choose OpenAI Live as the voice engine in Settings, Voice.',
  cancelled: 'The live voice connection was cancelled because its window closed.',
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
  'bad-response': 'OpenAI answered in a way this app did not understand.',
  'over-cap':
    "Today's live voice spending cap is reached. Voice calls start again tomorrow, or raise the cap in Settings, Voice.",
  'meter-unavailable':
    "Live calls are off because today's spending record (live-voice-meter.json in the Dobius+ data folder) could not be read or saved, so the daily cap cannot be checked. Fix or delete that file to call again."
}

export function liveVoiceFailure(kind: OpenAiLiveErrorKind): OpenAiLiveFailure {
  return fail(kind)
}

function fail(kind: OpenAiLiveErrorKind, detail = ''): OpenAiLiveFailure {
  return { ok: false, kind, error: detail ? `${ERROR_TEXT[kind]} ${detail}` : ERROR_TEXT[kind] }
}

// Why both passes: OpenAI echoes a masked key ("sk-abc***xyz") in some error
// text, and nothing key-shaped may reach the window or the log.
function scrubSecrets(text: string, apiKey: string): string {
  const withoutKey = apiKey ? text.split(apiKey).join('[hidden]') : text
  return withoutKey
    .replace(/sk-[A-Za-z0-9_\-*.]{3,}/g, '[hidden]')
    .replace(/ek_[A-Za-z0-9_-]*/g, '[hidden]')
    .replace(/(ice-(?:pwd|ufrag)|fingerprint)[:=]\S+/gi, '$1:[hidden]')
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
    options.idleTimeoutSec <= 60 &&
    (options.instructions === undefined ||
      (typeof options.instructions === 'string' &&
        options.instructions.length <= MAX_INSTRUCTIONS_CHARS))
  )
}

function buildSessionConfig(options: OpenAiLiveSessionOptions): Record<string, unknown> {
  return {
    model: OPENAI_LIVE_API.model,
    audio: { output: { voice: options.voice } },
    // Why always: without standby the session bills the full active rate for
    // as long as it is open (design doc section 4.3, rule 6).
    wake_policy: { type: 'speech' },
    idle_timeout_s: options.idleTimeoutSec,
    // Why no delegation field: `client` delegation (our app is the brain) is
    // the documented default (design doc section 1.3). Unverified against
    // the live API: the exact `instructions` field placement in this body.
    ...(options.instructions ? { instructions: options.instructions } : {})
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
        readNestedField(parsed, 'transport', 'sdp') ||
        readStringField(parsed, 'sdp') ||
        readNestedField(parsed, 'answer', 'sdp') ||
        readStringField(parsed, 'answer'),
      sessionId:
        readNestedField(parsed, 'session', 'id') ||
        readStringField(parsed, 'id') ||
        readStringField(parsed, 'session_id') ||
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

  const body = JSON.stringify({
    session: buildSessionConfig(options),
    transport: { type: 'webrtc', sdp: offerSdp }
  })

  if (deps.signal?.aborted) {
    return fail('cancelled')
  }
  const timeoutSignal = AbortSignal.timeout(deps.timeoutMs ?? OPENAI_LIVE_REQUEST_TIMEOUT_MS)
  let response: Response
  let raw: string
  try {
    response = await (deps.fetchImpl ?? fetch)(OPENAI_LIVE_API.sessionsUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
      signal: deps.signal ? AbortSignal.any([timeoutSignal, deps.signal]) : timeoutSignal
    })
    raw = await response.text()
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    const timedOut = name === 'TimeoutError' || name === 'AbortError'
    const kind = deps.signal?.aborted ? 'cancelled' : timedOut ? 'timeout' : 'network'
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
