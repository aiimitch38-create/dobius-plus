/* Dictation transport that sends audio to a self-hosted Parakeet service.
 *
 * Why this exists: Parakeet TDT v3 needs ~1 GB resident, which this Mac often
 * cannot spare, and a failed ONNX allocation aborts the whole Electron app
 * (see stt-memory-preflight). Hosting the model on the VPS gives Parakeet's
 * punctuation and capitalization at zero local memory cost. The small local
 * models (Zipformer/GigaSpeech) are trained on uppercase, unpunctuated
 * transcripts and cannot produce readable prose at any size.
 *
 * Transport: HTTP POST of a 16 kHz mono PCM WAV to /transcribe over Tailscale.
 * The service binds a Tailscale-only address, so reachability is the auth
 * boundary; there is no token to leak into config or logs. */

import { resampleToRate } from './stt-audio-resample'
import { combineChunks, encodePcm16Wav } from './stt-wav'

const VPS_TRANSCRIPTION_SAMPLE_RATE = 16000
/** Matches the service's MAX_BODY_BYTES (64 MB) with headroom to spare. */
const MAX_VPS_AUDIO_SECONDS = 10 * 60
const REQUEST_TIMEOUT_MS = 120_000
/** Short: the warm-up is best-effort and must never outlive the dictation. */
const WARMUP_TIMEOUT_MS = 5_000

export const DEFAULT_VPS_STT_ENDPOINT = 'http://100.98.24.1:8823'

type VpsTranscriptionResponse = {
  text?: string
  error?: string
  audio_seconds?: number
  decode_seconds?: number
  rtf?: number
}

/**
 * Turn transport failures into something a user can act on. The endpoint is a
 * private Tailscale address, so the overwhelmingly common failure is "Tailscale
 * is not running", not a server fault.
 */
export function describeVpsTranscriptionFailure(error: unknown, endpoint: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/abort|timeout/i.test(raw)) {
    return `Speech server at ${endpoint} timed out. It may still be loading the model.`
  }
  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|fetch failed/i.test(raw)) {
    return `Cannot reach the speech server at ${endpoint}. Check that Tailscale is running and the dobius-stt service is up.`
  }
  return `Speech server error: ${raw}`
}

export class VpsTranscriptionSession {
  private chunks: Float32Array[] = []
  private audioSeconds = 0

  constructor(private readonly endpoint: string = DEFAULT_VPS_STT_ENDPOINT) {}

  feedAudio(samples: Float32Array, sampleRate: number): void {
    const normalized = resampleToRate(samples, sampleRate, VPS_TRANSCRIPTION_SAMPLE_RATE)
    this.audioSeconds += normalized.length / VPS_TRANSCRIPTION_SAMPLE_RATE
    if (this.audioSeconds > MAX_VPS_AUDIO_SECONDS) {
      throw new Error('Server transcription is limited to 10 minutes per dictation')
    }
    this.chunks.push(new Float32Array(normalized))
  }

  /**
   * Open the path to the server while the user is still speaking.
   *
   * Why: measured 2026-09-08 against the live service, TCP connect to the
   * Tailscale endpoint swung between 0.077s and 2.9s depending on how recently
   * the path had been used, while an already-warm path answered /health in
   * 138ms. finish() is called on key-UP, so on a cold path the user pays that
   * whole setup cost after they have stopped talking, on top of the upload and
   * the decode. Touching /health on key-DOWN moves it into the time they are
   * already spending speaking.
   *
   * Fire-and-forget by design: this is an optimisation, and a failure here must
   * never break a dictation that finish() could still complete on its own.
   */
  warmUp(): void {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS)
    void fetch(`${this.endpoint.replace(/\/$/, '')}/health`, { signal: controller.signal })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer))
  }

  async finish(): Promise<string> {
    if (this.chunks.length === 0) {
      return ''
    }
    const startedAt = Date.now()

    const audio = combineChunks(this.chunks)
    this.chunks = []
    const wav = encodePcm16Wav(audio, VPS_TRANSCRIPTION_SAMPLE_RATE)
    const url = `${this.endpoint.replace(/\/$/, '')}/transcribe`

    // Why an explicit timeout: Parakeet is non-streaming, so a long dictation
    // legitimately takes seconds. Without a bound, an unreachable host would
    // hang the dictation session instead of surfacing an error.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: new Uint8Array(wav),
        signal: controller.signal,
      })
    } catch (error) {
      throw new Error(describeVpsTranscriptionFailure(error, this.endpoint))
    } finally {
      clearTimeout(timer)
    }

    const data = (await response.json().catch(() => ({}))) as VpsTranscriptionResponse
    if (!response.ok) {
      throw new Error(
        `Speech server returned ${response.status}${data.error ? `: ${data.error}` : ''}`,
      )
    }
    if (typeof data.text !== 'string') {
      throw new Error('Speech server response did not include text')
    }
    // Why log this: the server already reports how long it actually spent
    // decoding, and the client was discarding it — so a slow dictation gave no
    // way to tell a slow model from a slow network without hand-measuring.
    // Everything that is not decode is transport.
    const roundTripMs = Date.now() - startedAt
    const decodeMs = typeof data.decode_seconds === 'number' ? data.decode_seconds * 1000 : null
    console.info(
      `[speech] vps transcribe: audio=${data.audio_seconds ?? '?'}s ` +
        `decode=${decodeMs === null ? '?' : Math.round(decodeMs)}ms ` +
        `network=${decodeMs === null ? '?' : Math.round(roundTripMs - decodeMs)}ms ` +
        `roundTrip=${roundTripMs}ms rtf=${data.rtf ?? '?'} bytes=${wav.byteLength}`
    )
    return data.text
  }
}

/** Liveness probe for Settings. Never throws; returns false when unreachable. */
export async function checkVpsSttHealth(
  endpoint: string = DEFAULT_VPS_STT_ENDPOINT,
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, '')}/health`, {
      signal: controller.signal,
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
