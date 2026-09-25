import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { speakWithElevenLabs, type ElevenLabsConfig, type ElevenLabsSpeechIo } from './elevenlabs-client'

const CONFIG: ElevenLabsConfig = { apiKey: 'test-key', voiceId: 'voice', modelId: 'model' }
const FIRST = 'You have seventeen jobs in flight.'
const TWO_CHUNKS = `${FIRST} ${'x'.repeat(300)}`

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jarvis-tts-test-'))
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

type Recorder = { played: string[]; io: ElevenLabsSpeechIo }

function makeIo(overrides: Partial<ElevenLabsSpeechIo> = {}): Recorder {
  const played: string[] = []
  const io: ElevenLabsSpeechIo = {
    synthesize: async (text) => Buffer.from(text),
    write: (file, data) => writeFile(file, data),
    play: async (file) => {
      // Why: the file must still exist while "afplay" reads it.
      expect(existsSync(file)).toBe(true)
      played.push(file)
    },
    tempRoot: () => root,
    ...overrides
  }
  return { played, io }
}

function leftovers(): string[] {
  return readdirSync(root)
}

describe('speakWithElevenLabs temp dirs (#90)', () => {
  it('removes its temp dir after a successful reply', async () => {
    const { played, io } = makeIo()
    await speakWithElevenLabs(TWO_CHUNKS, CONFIG, io)
    expect(played).toHaveLength(2)
    expect(leftovers()).toEqual([])
  })

  it('removes its temp dir when the first synthesis fails', async () => {
    const { played, io } = makeIo({
      synthesize: async () => {
        throw new Error('ElevenLabs HTTP 500')
      }
    })
    await expect(speakWithElevenLabs(TWO_CHUNKS, CONFIG, io)).rejects.toThrow('HTTP 500')
    expect(played).toEqual([])
    expect(leftovers()).toEqual([])
  })

  it('removes its temp dir when playback is cancelled (afplay killed)', async () => {
    const killed = Object.assign(new Error('Command failed: afplay'), {
      killed: true,
      signal: 'SIGTERM'
    })
    const { io } = makeIo({
      play: async () => {
        throw killed
      }
    })
    await expect(speakWithElevenLabs('Short reply.', CONFIG, io)).rejects.toBe(killed)
    expect(leftovers()).toEqual([])
  })

  it('does not delete a file that is still playing', async () => {
    let finishFirst!: () => void
    let dirDuringPlayback: string[] = []
    const { io } = makeIo({
      synthesize: async (text) => {
        if (text !== FIRST) {
          throw new Error('second chunk failed')
        }
        return Buffer.from(text)
      },
      play: (file) =>
        new Promise<void>((resolve) => {
          finishFirst = () => {
            dirDuringPlayback = existsSync(file) ? [file] : []
            resolve()
          }
        })
    })
    const speaking = speakWithElevenLabs(TWO_CHUNKS, CONFIG, io)
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'))
    // The second synthesis has failed by now; the first file must survive.
    await new Promise((resolve) => setTimeout(resolve, 10))
    finishFirst()
    await speaking
    expect(dirDuringPlayback).toHaveLength(1)
    expect(leftovers()).toEqual([])
  })
})

describe('speakWithElevenLabs after partial playback (#91)', () => {
  it('does not ask for a replay when the second synthesis fails', async () => {
    const { played, io } = makeIo({
      synthesize: async (text) => {
        if (text !== FIRST) {
          throw new Error('second chunk failed')
        }
        return Buffer.from(text)
      }
    })
    await expect(speakWithElevenLabs(TWO_CHUNKS, CONFIG, io)).resolves.toBeUndefined()
    expect(played).toHaveLength(1)
    expect(leftovers()).toEqual([])
  })

  it('does not ask for a replay when writing the second file fails', async () => {
    let writes = 0
    const { played, io } = makeIo({
      write: async (file, data) => {
        writes += 1
        if (writes === 2) {
          throw new Error('ENOSPC')
        }
        await writeFile(file, data)
      }
    })
    await expect(speakWithElevenLabs(TWO_CHUNKS, CONFIG, io)).resolves.toBeUndefined()
    expect(played).toHaveLength(1)
    expect(leftovers()).toEqual([])
  })

  it('does not ask for a replay when the second playback fails', async () => {
    const played: string[] = []
    const { io } = makeIo({
      play: async (file) => {
        if (played.length === 1) {
          throw new Error('afplay exited 1')
        }
        played.push(file)
      }
    })
    await expect(speakWithElevenLabs(TWO_CHUNKS, CONFIG, io)).resolves.toBeUndefined()
    expect(played).toHaveLength(1)
    expect(leftovers()).toEqual([])
  })

  it('still rejects when the first chunk never played, so the local voice speaks', async () => {
    const { io } = makeIo({
      play: async () => {
        throw new Error('afplay exited 1')
      }
    })
    await expect(speakWithElevenLabs(TWO_CHUNKS, CONFIG, io)).rejects.toThrow('afplay exited 1')
    expect(leftovers()).toEqual([])
  })
})
