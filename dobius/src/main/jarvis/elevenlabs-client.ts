import { execFile } from 'node:child_process'
import { writeFile as writeFileAsync } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lastSentenceEnd } from './sentence-stream'

export type ElevenLabsConfig = {
  apiKey: string
  voiceId: string
  modelId: string
}

/** Voice-settings fields that carry ElevenLabs credentials. */
export type ElevenLabsSettings = {
  elevenlabsApiKey?: string
  elevenlabsVoiceId?: string
  elevenlabsModelId?: string
}

/**
 * Settings win over env: the in-app Voice pane is where a user can actually
 * change this, and a GUI app launched from Finder inherits no shell exports.
 */
export function resolveElevenLabsConfig(
  settings?: ElevenLabsSettings | null,
  env: NodeJS.ProcessEnv = process.env
): ElevenLabsConfig | null {
  const apiKey = settings?.elevenlabsApiKey?.trim() || env.ELEVENLABS_API_KEY?.trim()
  const voiceId = settings?.elevenlabsVoiceId?.trim() || env.ELEVENLABS_VOICE_ID?.trim()
  // No key or no voice pinned -> stay on the free local engine rather than
  // guessing a billed voice or failing a spoken reply over missing config.
  if (!apiKey || !voiceId) {return null}
  const modelId =
    settings?.elevenlabsModelId?.trim() || env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_turbo_v2_5'
  return { apiKey, voiceId, modelId }
}

export async function synthesizeToMp3(text: string, config: ElevenLabsConfig, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream?optimize_streaming_latency=3`, {
    method: 'POST',
    headers: { 'xi-api-key': config.apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: text.slice(0, 2500), model_id: config.modelId }),
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) {throw new Error(`ElevenLabs HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)}
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) {throw new Error('ElevenLabs returned empty audio')}
  return buffer
}

export function playMp3(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/afplay', [filePath], {}, (error) => error ? reject(error) : resolve())
  })
}

const FIRST_CHUNK_MAX_CHARS = 200

/**
 * Splits a reply so the first spoken chunk is short. Time-to-first-word then
 * depends on one sentence instead of the whole answer.
 * ponytail: two chunks, not N — the second sentence's audio is already being
 * fetched while the first plays, so further splitting buys nothing.
 */
export function chunkForSpeech(text: string): string[] {
  const trimmed = text.trim()
  if (trimmed.length <= FIRST_CHUNK_MAX_CHARS) {return [trimmed]}
  const head = trimmed.slice(0, FIRST_CHUNK_MAX_CHARS)
  const end = lastSentenceEnd(head)
  // A too-early break would speak a fragment; one shot reads better than "Yes."
  if (end < 21) {return [trimmed]}
  return [trimmed.slice(0, end).trim(), trimmed.slice(end).trim()]
}

export async function speakWithElevenLabs(text: string, config: ElevenLabsConfig): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-tts-'))
  const chunks = chunkForSpeech(text)
  // afplay has no stdin, so each chunk lands in a file; playback is chained
  // while the next chunk is still being synthesized.
  let playing: Promise<void> = Promise.resolve()
  for (let index = 0; index < chunks.length; index += 1) {
    let mp3: Buffer
    try {
      mp3 = await synthesizeToMp3(chunks[index], config)
    } catch (error) {
      // Once audio is playing, keep it: the caller's local-engine fallback
      // would otherwise restate the whole reply on top of what was said.
      if (index > 0) {break}
      throw error
    }
    const file = join(dir, `reply-${index}.mp3`)
    await writeFileAsync(file, mp3)
    playing = playing.then(() => playMp3(file))
  }
  await playing
}
