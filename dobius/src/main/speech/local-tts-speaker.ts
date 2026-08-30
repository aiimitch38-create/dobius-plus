import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chunkForSpeech } from '../jarvis/elevenlabs-client'
import type { TtsAudio } from './local-tts'
import { getSherpaModulePath } from './sherpa-module-path'

export type WavPlayback = {
  done: Promise<void>
  stop: () => void
}

export type LocalSpeakerDeps = {
  synthesize: (text: string) => Promise<TtsAudio>
  writeWave?: (filename: string, audio: { samples: Float32Array; sampleRate: number }) => void
  playWav?: (path: string) => WavPlayback
  chunk?: (text: string) => string[]
}

function playWavWithAfplay(path: string): WavPlayback {
  let stopped = false
  let child: ReturnType<typeof execFile> | null = null
  const done = new Promise<void>((resolve, reject) => {
    child = execFile('/usr/bin/afplay', [path], (error) => {
      // A kill from stop() is a requested outcome, not a playback failure.
      if (error && !stopped) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
  return {
    done,
    stop: () => {
      stopped = true
      child?.kill('SIGKILL')
    }
  }
}

function defaultWriteWave(
  filename: string,
  audio: { samples: Float32Array; sampleRate: number }
): void {
  const sherpa = require(getSherpaModulePath()) as {
    writeWave: (filename: string, audio: { samples: Float32Array; sampleRate: number }) => void
  }
  sherpa.writeWave(filename, audio)
}

/**
 * Speaks text through the local TTS engine: chunk → synthesize → WAV → afplay.
 *
 * Mirrors `speakWithElevenLabs`: the next chunk synthesizes while the current
 * one plays, and a failure after audio has started keeps what is playing
 * rather than letting the caller's fallback restate the reply on top of it.
 *
 * `stop()` exists for barge-in (TASK-VOICE-3.1): it drops every un-played
 * chunk and kills the current afplay child; a stopped playback resolves
 * cleanly so `speak()` returns without tripping the caller's fallback.
 */
export class LocalSpeaker {
  private readonly deps: LocalSpeakerDeps
  private current: WavPlayback | null = null
  private generation = 0

  constructor(deps: LocalSpeakerDeps) {
    this.deps = deps
  }

  isSpeaking(): boolean {
    return this.current !== null
  }

  async speak(text: string): Promise<void> {
    const gen = this.generation
    const chunks = (this.deps.chunk ?? chunkForSpeech)(text)
    const writeWave = this.deps.writeWave ?? defaultWriteWave
    const playWav = this.deps.playWav ?? playWavWithAfplay
    const dir = mkdtempSync(join(tmpdir(), 'dobius-local-tts-'))
    let playing: Promise<void> = Promise.resolve()
    let startedAudio = false
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        if (gen !== this.generation) {
          break
        }
        let audio: TtsAudio
        try {
          audio = await this.deps.synthesize(chunks[index])
        } catch (error) {
          if (startedAudio) {
            break
          }
          throw error
        }
        const file = join(dir, `chunk-${index}.wav`)
        writeWave(file, { samples: audio.samples, sampleRate: audio.sampleRate })
        startedAudio = true
        playing = playing.then(() => {
          if (gen !== this.generation) {
            return
          }
          const playback = playWav(file)
          this.current = playback
          return playback.done.finally(() => {
            if (this.current === playback) {
              this.current = null
            }
          })
        })
      }
      await playing
    } finally {
      // afplay holds an open fd, so unlinking a file mid-play is safe on macOS.
      rmSync(dir, { recursive: true, force: true })
    }
  }

  stop(): void {
    this.generation += 1
    this.current?.stop()
    this.current = null
  }
}
