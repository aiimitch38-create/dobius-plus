import {
  DEFAULT_LIVE_VOICE_DAILY_CAP_USD,
  DEFAULT_LIVE_VOICE_ENGINE,
  DEFAULT_LIVE_VOICE_IDLE_TIMEOUT_SEC,
  DEFAULT_LIVE_VOICE_MIC_MODE,
  DEFAULT_OPENAI_LIVE_VOICE
} from './constants'
import type { LiveVoiceEngine, LiveVoiceMicMode, VoiceSettings } from './speech-types'

// Why 5 to 60: the Live API accepts idle_timeout_s only as a whole number in
// that range (plans/research/REALTIME-VOICE-ADAM.md section 1.6).
export const LIVE_VOICE_IDLE_TIMEOUT_MIN_SEC = 5
export const LIVE_VOICE_IDLE_TIMEOUT_MAX_SEC = 60
export const LIVE_VOICE_DAILY_CAP_MIN_USD = 1
export const LIVE_VOICE_DAILY_CAP_MAX_USD = 500

const VOICE_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/

export type LiveVoiceSettings = {
  engine: LiveVoiceEngine
  voice: string
  micMode: LiveVoiceMicMode
  dailyCapUsd: number
  idleTimeoutSec: number
}

/**
 * False until the window-side live call (design doc build task 2) lands. While
 * false the orb keeps running the fallback engine even with a key saved.
 */
export const OPENAI_LIVE_CALL_READY = false

// Why typeof: saved settings can be hand-edited or damaged, and loading them
// must never throw on a non-string agent id.
function hasElevenLabsAgentId(voice: VoiceSettings | undefined): boolean {
  const agentId: unknown = voice?.elevenlabsAgentId
  return typeof agentId === 'string' && agentId.trim() !== ''
}

/**
 * The engine used before OpenAI Live existed, and the one the orb falls back
 * to when OpenAI Live cannot run: ElevenLabs live only with an agent id saved
 * and preferNativeAdamVoice explicitly off, otherwise Hermes turns.
 */
export function resolveFallbackVoiceEngine(
  voice: VoiceSettings | undefined
): Exclude<LiveVoiceEngine, 'openai-live'> {
  const elevenLabsLive = voice?.preferNativeAdamVoice === false && hasElevenLabsAgentId(voice)
  return elevenLabsLive ? 'elevenlabs' : 'hermes'
}

/**
 * The engine the user has chosen. Also the load-time migration for settings
 * saved before the choice existed: someone who explicitly switched to the
 * ElevenLabs conversation keeps it, everyone else moves to the new default.
 */
export function resolveLiveVoiceEngine(voice: VoiceSettings | undefined): LiveVoiceEngine {
  const stored = voice?.liveVoiceEngine
  if (stored === 'hermes' || stored === 'elevenlabs' || stored === 'openai-live') {
    return stored
  }
  return resolveFallbackVoiceEngine(voice) === 'elevenlabs'
    ? 'elevenlabs'
    : DEFAULT_LIVE_VOICE_ENGINE
}

/**
 * The engine the orb actually runs right now. OpenAI Live needs a saved key
 * (and the live call to exist); otherwise voice keeps working on the fallback
 * engine instead of failing.
 */
export function resolveActiveVoiceEngine(
  voice: VoiceSettings | undefined,
  openAiLiveAvailable: boolean = voice?.openAiApiKeyConfigured === true && OPENAI_LIVE_CALL_READY
): LiveVoiceEngine {
  const chosen = resolveLiveVoiceEngine(voice)
  if (chosen === 'openai-live') {
    return openAiLiveAvailable ? 'openai-live' : resolveFallbackVoiceEngine(voice)
  }
  if (chosen === 'elevenlabs' && !hasElevenLabsAgentId(voice)) {
    return 'hermes'
  }
  return chosen
}

export function normalizeOpenAiLiveVoice(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return VOICE_NAME_PATTERN.test(name) ? name : DEFAULT_OPENAI_LIVE_VOICE
}

export function normalizeLiveVoiceMicMode(value: unknown): LiveVoiceMicMode {
  return value === 'hands-free' || value === 'push-to-talk' ? value : DEFAULT_LIVE_VOICE_MIC_MODE
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}

export function normalizeLiveVoiceDailyCapUsd(value: unknown): number {
  const clamped = clampNumber(
    value,
    LIVE_VOICE_DAILY_CAP_MIN_USD,
    LIVE_VOICE_DAILY_CAP_MAX_USD,
    DEFAULT_LIVE_VOICE_DAILY_CAP_USD
  )
  return Math.round(clamped * 100) / 100
}

export function normalizeLiveVoiceIdleTimeoutSec(value: unknown): number {
  return Math.round(
    clampNumber(
      value,
      LIVE_VOICE_IDLE_TIMEOUT_MIN_SEC,
      LIVE_VOICE_IDLE_TIMEOUT_MAX_SEC,
      DEFAULT_LIVE_VOICE_IDLE_TIMEOUT_SEC
    )
  )
}

/** Stored settings can be hand-edited or from an older build: never trust them raw. */
export function resolveLiveVoiceSettings(voice: VoiceSettings | undefined): LiveVoiceSettings {
  return {
    engine: resolveLiveVoiceEngine(voice),
    voice: normalizeOpenAiLiveVoice(voice?.openAiLiveVoice),
    micMode: normalizeLiveVoiceMicMode(voice?.liveVoiceMicMode),
    dailyCapUsd: normalizeLiveVoiceDailyCapUsd(voice?.liveVoiceDailyCapUsd),
    idleTimeoutSec: normalizeLiveVoiceIdleTimeoutSec(voice?.liveVoiceIdleTimeoutSec)
  }
}
