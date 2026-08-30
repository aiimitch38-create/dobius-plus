import { basename } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { LocalSpeaker, type WavPlayback } from './local-tts-speaker'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/unused' } }))

type PlaybackControl = WavPlayback & { resolveDone: () => void }

function makeHarness(chunks: string[]): {
  speaker: LocalSpeaker
  played: string[]
  playbacks: PlaybackControl[]
  synthesize: ReturnType<typeof vi.fn>
  stopCalls: number[]
} {
  const played: string[] = []
  const playbacks: PlaybackControl[] = []
  const stopCalls: number[] = []
  const synthesize = vi.fn(async () => ({
    samples: new Float32Array([0.1]),
    sampleRate: 24000
  }))
  const speaker = new LocalSpeaker({
    synthesize,
    chunk: () => chunks,
    writeWave: vi.fn(),
    playWav: (path: string) => {
      played.push(basename(path))
      let resolveDone!: () => void
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve
      })
      const index = playbacks.length
      const playback: PlaybackControl = {
        done,
        resolveDone,
        stop: () => {
          stopCalls.push(index)
          resolveDone()
        }
      }
      playbacks.push(playback)
      return playback
    }
  })
  return { speaker, played, playbacks, synthesize, stopCalls }
}

describe('LocalSpeaker.speak', () => {
  it('plays chunks sequentially in order', async () => {
    const h = makeHarness(['First sentence.', 'Second sentence.', 'Third.'])
    const speaking = h.speaker.speak('ignored — chunker is injected')
    await vi.waitFor(() => expect(h.played).toEqual(['chunk-0.wav']))
    h.playbacks[0].resolveDone()
    await vi.waitFor(() => expect(h.played).toEqual(['chunk-0.wav', 'chunk-1.wav']))
    h.playbacks[1].resolveDone()
    await vi.waitFor(() => expect(h.played.length).toBe(3))
    h.playbacks[2].resolveDone()
    await speaking
    expect(h.synthesize).toHaveBeenCalledTimes(3)
  })

  it('rejects when the FIRST chunk fails to synthesize (fallback engine takes over)', async () => {
    const h = makeHarness(['Only chunk.'])
    h.synthesize.mockRejectedValueOnce(new Error('model load failed'))
    await expect(h.speaker.speak('x')).rejects.toThrow('model load failed')
    expect(h.played).toEqual([])
  })

  it('keeps already-started audio when a LATER chunk fails', async () => {
    const h = makeHarness(['First.', 'Second.'])
    h.synthesize
      .mockResolvedValueOnce({ samples: new Float32Array([0.1]), sampleRate: 24000 })
      .mockRejectedValueOnce(new Error('mid-reply failure'))
    const speaking = h.speaker.speak('x')
    await vi.waitFor(() => expect(h.played).toEqual(['chunk-0.wav']))
    h.playbacks[0].resolveDone()
    // Resolves rather than rejects: the caller's fallback must not restate the
    // reply on top of the audio that already played.
    await expect(speaking).resolves.toBeUndefined()
    expect(h.played).toEqual(['chunk-0.wav'])
  })

  it('stop() kills current playback and drops the unplayed queue', async () => {
    const h = makeHarness(['First.', 'Second.', 'Third.'])
    const speaking = h.speaker.speak('x')
    await vi.waitFor(() => expect(h.played).toEqual(['chunk-0.wav']))
    expect(h.speaker.isSpeaking()).toBe(true)
    h.speaker.stop()
    expect(h.stopCalls).toEqual([0])
    await speaking
    // Nothing after the stopped chunk ever reaches the audio device.
    expect(h.played).toEqual(['chunk-0.wav'])
    expect(h.speaker.isSpeaking()).toBe(false)
  })

  it('a speak() after stop() plays normally again', async () => {
    const h = makeHarness(['One.'])
    const first = h.speaker.speak('x')
    await vi.waitFor(() => expect(h.played.length).toBe(1))
    h.speaker.stop()
    await first
    const second = h.speaker.speak('y')
    await vi.waitFor(() => expect(h.played.length).toBe(2))
    h.playbacks[1].resolveDone()
    await second
  })
})
