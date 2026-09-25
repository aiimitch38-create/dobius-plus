import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile as writeFileAsync } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveElevenLabsApiKey } from './elevenlabs-key-store'

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
 * The key comes from the protected key store (#24), which also covers a legacy
 * settings key that has not been migrated out yet.
 */
export function resolveElevenLabsConfig(
  settings?: ElevenLabsSettings | null,
  env: NodeJS.ProcessEnv = process.env,
  readStoredApiKey: () => string = () => resolveElevenLabsApiKey(settings ?? undefined)
): ElevenLabsConfig | null {
  const voiceId = settings?.elevenlabsVoiceId?.trim() || env.ELEVENLABS_VOICE_ID?.trim()
  // No key or no voice pinned -> stay on the free local engine rather than
  // guessing a billed voice or failing a spoken reply over missing config.
  if (!voiceId) {return null}
  const apiKey = readStoredApiKey().trim() || env.ELEVENLABS_API_KEY?.trim()
  if (!apiKey) {return null}
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
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  // A too-early break would speak a fragment; one shot reads better than "Yes."
  if (cut < 20) {return [trimmed]}
  return [trimmed.slice(0, cut + 1).trim(), trimmed.slice(cut + 1).trim()]
}

/** Seams for tests; production uses the real HTTP, afplay and temp dir. */
export type ElevenLabsSpeechIo = {
  synthesize: (text: string, config: ElevenLabsConfig) => Promise<Buffer>
  write: (filePath: string, data: Buffer) => Promise<void>
  play: (filePath: string) => Promise<void>
  tempRoot: () => string
}

const DEFAULT_SPEECH_IO: ElevenLabsSpeechIo = {
  synthesize: (text, config) => synthesizeToMp3(text, config),
  write: (filePath, data) => writeFileAsync(filePath, data),
  play: playMp3,
  tempRoot: tmpdir
}

/**
 * Rejects only when nothing was heard, so the caller's local-engine fallback
 * can say the reply instead. Once a chunk has played in full, a later failure
 * ends the reply there (#91): the fallback would restate the whole reply on
 * top of what was already said.
 */
export async function speakWithElevenLabs(
  text: string,
  config: ElevenLabsConfig,
  io: ElevenLabsSpeechIo = DEFAULT_SPEECH_IO
): Promise<void> {
  const dir = await mkdtemp(join(io.tempRoot(), 'jarvis-tts-'))
  const chunks = chunkForSpeech(text)
  let playedChunks = 0
  // afplay has no stdin, so each chunk lands in a file; playback is chained
  // while the next chunk is still being synthesized.
  let playing: Promise<void> = Promise.resolve()
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const mp3 = await io.synthesize(chunks[index], config)
      const file = join(dir, `reply-${index}.mp3`)
      await io.write(file, mp3)
      playing = playing.then(async () => {
        await io.play(file)
        playedChunks += 1
      })
      // Why: a playback failure during the next synthesis would otherwise be
      // an unhandled rejection; it is still read by the awaits below.
      playing.catch(() => undefined)
    }
    await playing
  } catch (error) {
    // Why wait: an earlier chunk may still be playing. Whether it finishes
    // decides if anything was heard, and the fallback must not talk over it.
    await playing.catch(() => undefined)
    if (playedChunks === 0) {
      throw error
    }
    console.warn(
      '[jarvis] ElevenLabs reply cut short after audio played:',
      error instanceof Error ? error.message : String(error)
    )
  } finally {
    await playing.catch(() => undefined)
    // Why after playback settles: afplay reads the files until it exits (#90).
    await rm(dir, { recursive: true, force: true }).catch((error: unknown) => {
      console.warn(
        '[jarvis] could not remove TTS temp dir:',
        error instanceof Error ? error.message : String(error)
      )
    })
  }
}
