import { describe, expect, it, vi } from 'vitest'
import type { SttEvent, SttEventSink } from '../speech/stt-service'
import { LocalSpeaker, type WavPlayback } from '../speech/local-tts-speaker'
import { createBargeIn, tapSttKeywordDetections } from './barge-in'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/unused' } }))

describe('createBargeIn decision', () => {
  it('a keyword while TTS is speaking stops playback and notifies', () => {
    const stopTts = vi.fn()
    const onBargedIn = vi.fn()
    const bargeIn = createBargeIn({ isTtsSpeaking: () => true, stopTts, onBargedIn })
    expect(bargeIn.onKeywordDetected()).toBe(true)
    expect(stopTts).toHaveBeenCalledTimes(1)
    expect(onBargedIn).toHaveBeenCalledTimes(1)
  })

  it('no flush when TTS is idle', () => {
    const stopTts = vi.fn()
    const onBargedIn = vi.fn()
    const bargeIn = createBargeIn({ isTtsSpeaking: () => false, stopTts, onBargedIn })
    expect(bargeIn.onKeywordDetected()).toBe(false)
    expect(stopTts).not.toHaveBeenCalled()
    expect(onBargedIn).not.toHaveBeenCalled()
  })
})

describe('barge-in against the real LocalSpeaker queue', () => {
  it('flush empties the queue, kills current playback, and emits the stopped notification', async () => {
    const played: string[] = []
    const stops: number[] = []
    let currentResolve: (() => void) | null = null
    const speaker = new LocalSpeaker({
      synthesize: async () => ({ samples: new Float32Array([0]), sampleRate: 24000 }),
      chunk: () => ['One.', 'Two.', 'Three.'],
      writeWave: vi.fn(),
      playWav: (path: string): WavPlayback => {
        played.push(path)
        let resolveDone!: () => void
        const done = new Promise<void>((resolve) => {
          resolveDone = resolve
        })
        currentResolve = resolveDone
        const index = played.length - 1
        return {
          done,
          stop: () => {
            stops.push(index)
            resolveDone()
          }
        }
      }
    })
    const onBargedIn = vi.fn()
    const bargeIn = createBargeIn({
      isTtsSpeaking: () => speaker.isSpeaking(),
      stopTts: () => speaker.stop(),
      onBargedIn
    })

    const speaking = speaker.speak('x')
    await vi.waitFor(() => expect(played.length).toBe(1))

    expect(bargeIn.onKeywordDetected()).toBe(true)
    expect(stops).toEqual([0])
    expect(onBargedIn).toHaveBeenCalledTimes(1)

    await speaking
    // Queue was flushed: chunks two and three never reach the audio device.
    expect(played.length).toBe(1)
    expect(speaker.isSpeaking()).toBe(false)
    expect(currentResolve).not.toBeNull()
  })
})

describe('tapSttKeywordDetections', () => {
  function makeFakeStt(): {
    stt: { startDictation: (m: string, s: SttEventSink) => Promise<void> }
    emit: (event: SttEvent) => void
  } {
    let installedSink: SttEventSink | null = null
    return {
      stt: {
        startDictation: async (_modelId: string, sink: SttEventSink) => {
          installedSink = sink
        }
      },
      emit: (event) => installedSink?.(event)
    }
  }

  it('routes keyword events to the observer and passes everything through', async () => {
    const fake = makeFakeStt()
    const onKeyword = vi.fn()
    tapSttKeywordDetections(fake.stt, onKeyword)
    const seen: SttEvent[] = []
    await fake.stt.startDictation('model', (event) => seen.push(event))
    fake.emit({ type: 'keyword', keyword: 'adam' })
    fake.emit({ type: 'final', text: 'hello' })
    expect(onKeyword).toHaveBeenCalledWith('adam')
    expect(onKeyword).toHaveBeenCalledTimes(1)
    expect(seen.map((e) => e.type)).toEqual(['keyword', 'final'])
  })
})
