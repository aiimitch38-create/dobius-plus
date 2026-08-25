import { execFile } from 'node:child_process'
import { writeFile as writeFileAsync } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type ElevenLabsConfig = {
  apiKey: string
  voiceId: string
  modelId: string
}

export function resolveElevenLabsConfig(env: NodeJS.ProcessEnv = process.env): ElevenLabsConfig | null {
  const apiKey = env.ELEVENLABS_API_KEY?.trim()
  const voiceId = env.ELEVENLABS_VOICE_ID?.trim()
  // No key or no voice pinned -> stay on the free local engine rather than
  // guessing a billed voice or failing a spoken reply over missing config.
  if (!apiKey || !voiceId) return null
  return { apiKey, voiceId, modelId: env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_turbo_v2_5' }
}

/**
 * Settings-entered credentials (Settings → Voice) win over env vars so Carson
 * can change voice without touching a terminal; env remains the fallback.
 */
export function resolveElevenLabsConfigFromSettings(
  settings: { elevenlabsApiKey?: string; elevenlabsVoiceId?: string } | undefined,
  env: NodeJS.ProcessEnv = process.env
): ElevenLabsConfig | null {
  const apiKey = settings?.elevenlabsApiKey?.trim() || env.ELEVENLABS_API_KEY?.trim()
  const voiceId = settings?.elevenlabsVoiceId?.trim() || env.ELEVENLABS_VOICE_ID?.trim()
  if (!apiKey || !voiceId) return null
  return { apiKey, voiceId, modelId: env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_turbo_v2_5' }
}

export async function synthesizeToMp3(text: string, config: ElevenLabsConfig, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}`, {
    method: 'POST',
    headers: { 'xi-api-key': config.apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: text.slice(0, 2500), model_id: config.modelId }),
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new Error(`ElevenLabs HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) throw new Error('ElevenLabs returned empty audio')
  return buffer
}

export function playMp3(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/afplay', [filePath], {}, (error) => error ? reject(error) : resolve())
  })
}

export async function speakWithElevenLabs(text: string, config: ElevenLabsConfig): Promise<void> {
  const mp3 = await synthesizeToMp3(text, config)
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-tts-'))
  const file = join(dir, 'reply.mp3')
  await writeFileAsync(file, mp3)
  await playMp3(file)
}
