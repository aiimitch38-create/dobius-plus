import { resampleToRate } from './stt-audio-resample'
import { combineChunks, encodePcm16Wav } from './stt-wav'

export const OPENAI_TRANSCRIPTION_MODEL_BY_ID: Record<string, string> = {
  'openai-gpt-4o-mini-transcribe': 'gpt-4o-mini-transcribe',
  'openai-gpt-4o-transcribe': 'gpt-4o-transcribe'
}

const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions'
const CLOUD_TRANSCRIPTION_SAMPLE_RATE = 16000
const MAX_CLOUD_AUDIO_SECONDS = 10 * 60
export const OPENAI_TRANSCRIPTION_TIMEOUT_MS = 120_000

type OpenAiTranscriptionResponse = {
  text?: unknown
  error?: {
    message?: unknown
  }
}

export function sanitizeOpenAiTranscriptionErrorMessage(message: string): string {
  if (/incorrect api key provided:/i.test(message)) {
    return 'Incorrect OpenAI API key provided.'
  }

  const sanitized = message
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .trim()

  return sanitized || 'OpenAI transcription request failed'
}

function parseOpenAiTranscriptionResponse(data: OpenAiTranscriptionResponse): string {
  if (typeof data.text === 'string') {
    return data.text.trim()
  }
  if (typeof data.error?.message === 'string') {
    throw new Error(sanitizeOpenAiTranscriptionErrorMessage(data.error.message))
  }
  throw new Error('OpenAI transcription response did not include text')
}

function openAiTranscriptionTimeoutError(): Error {
  return new Error(
    `OpenAI transcription timed out after ${OPENAI_TRANSCRIPTION_TIMEOUT_MS / 1000} seconds`
  )
}

export class OpenAiTranscriptionSession {
  private chunks: Float32Array[] = []
  private audioSeconds = 0

  constructor(
    private readonly modelId: string,
    private readonly readApiKey: () => string
  ) {}

  feedAudio(samples: Float32Array, sampleRate: number): void {
    const normalized = resampleToRate(samples, sampleRate, CLOUD_TRANSCRIPTION_SAMPLE_RATE)
    this.audioSeconds += normalized.length / CLOUD_TRANSCRIPTION_SAMPLE_RATE
    if (this.audioSeconds > MAX_CLOUD_AUDIO_SECONDS) {
      throw new Error('Cloud transcription is limited to 10 minutes per dictation')
    }
    this.chunks.push(new Float32Array(normalized))
  }

  async finish(): Promise<string> {
    if (this.chunks.length === 0) {
      return ''
    }

    const apiModel = OPENAI_TRANSCRIPTION_MODEL_BY_ID[this.modelId]
    if (!apiModel) {
      throw new Error(`Unknown OpenAI transcription model: ${this.modelId}`)
    }

    const audio = combineChunks(this.chunks)
    this.chunks = []
    const wav = encodePcm16Wav(audio, CLOUD_TRANSCRIPTION_SAMPLE_RATE)
    const form = new FormData()
    form.append('model', apiModel)
    form.append('response_format', 'json')
    // Why: OpenAI's transcription endpoint expects a multipart file object;
    // a named WAV blob avoids filesystem temp files and works in packaged apps.
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'dictation.wav')

    // Why: without a bound, a stalled upload or response leaves dictation stuck
    // in "Processing…" forever. The timer also covers reading the body.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), OPENAI_TRANSCRIPTION_TIMEOUT_MS)
    let response: Response
    let data: OpenAiTranscriptionResponse
    try {
      response = await fetch(OPENAI_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.readApiKey()}`
        },
        body: form,
        signal: controller.signal
      })
      data = (await response.json().catch(() => ({}))) as OpenAiTranscriptionResponse
    } catch (error) {
      if (controller.signal.aborted) {
        throw openAiTranscriptionTimeoutError()
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
    if (controller.signal.aborted) {
      throw openAiTranscriptionTimeoutError()
    }
    if (!response.ok) {
      const message =
        typeof data.error?.message === 'string'
          ? sanitizeOpenAiTranscriptionErrorMessage(data.error.message)
          : response.statusText
      throw new Error(`OpenAI transcription failed: ${message}`)
    }

    return parseOpenAiTranscriptionResponse(data)
  }
}
