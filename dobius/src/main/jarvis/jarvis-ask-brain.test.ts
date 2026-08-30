import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { SpeakOutcome } from '../communications/huddles/huddle-speech-synthesis'
import type { VoiceSettings } from '../../shared/speech-types'
import { JarvisService } from './jarvis-service'

type LocalSpeakMock = Mock<(text: string) => Promise<void>>

async function* sentences(parts: string[]): AsyncIterable<string> {
  for (const part of parts) {
    yield part
  }
}

function makeService(
  voice: Partial<VoiceSettings>,
  opts: {
    brain?: { ask(utterance: string): AsyncIterable<string> }
    localSpeak?: LocalSpeakMock
  } = {}
): {
  service: JarvisService
  speakQueue: Mock<(text: string) => Promise<SpeakOutcome>>
  fetchFn: Mock
  broadcast: Mock
} {
  const speakQueue = vi.fn<(text: string) => Promise<SpeakOutcome>>()
  speakQueue.mockResolvedValue({ played: true, engine: 'say' })
  const fetchFn = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, result: { kind: 'answer', text: 'Adam fallback answer' } })
  }))
  const broadcast = vi.fn()
  const service = new JarvisService({
    store: { getSettings: () => ({ voice: { adamEndpoint: 'http://adam.test', ...voice } as VoiceSettings }) },
    broadcast,
    shortcut: { register: () => true, unregister: () => undefined },
    fetchFn: fetchFn as unknown as typeof fetch,
    speakQueue,
    localSpeak: opts.localSpeak,
    brain: opts.brain
  })
  return { service, speakQueue, fetchFn, broadcast }
}

describe('jarvis ask prefers the streaming brain in local mode', () => {
  it('speaks each brain sentence in order and never calls ADAM', async () => {
    const localSpeak: LocalSpeakMock = vi.fn(async () => undefined)
    const brain = { ask: vi.fn(() => sentences(['First point.', 'Second point.'])) }
    const h = makeService({ voiceEngine: 'local' }, { brain, localSpeak })
    const result = await h.service.ask('what happened?')
    expect(result).toEqual({ kind: 'answer', text: 'First point. Second point.' })
    expect(localSpeak.mock.calls.map((c) => c[0])).toEqual(['First point.', 'Second point.'])
    expect(brain.ask).toHaveBeenCalledWith('what happened?')
    expect(h.fetchFn).not.toHaveBeenCalled()
  })

  it('holds one continuous speaking phase across streamed sentences', async () => {
    const localSpeak: LocalSpeakMock = vi.fn(async () => undefined)
    const brain = { ask: () => sentences(['One.', 'Two.', 'Three.']) }
    const h = makeService({ voiceEngine: 'local' }, { brain, localSpeak })
    await h.service.ask('go')
    const phases = h.broadcast.mock.calls
      .filter((c) => c[0] === 'jarvis:state')
      .map((c) => (c[1] as { state: string }).state)
    // thinking once, speaking once (not per sentence), idle once.
    expect(phases).toEqual(['thinking', 'speaking', 'idle'])
  })

  it('falls back to ADAM when the brain fails before any audio', async () => {
    const brain = {
      // Fails before the first sentence — a manual iterator avoids a
      // yield-less generator (which lint rejects).
      ask: (): AsyncIterable<string> => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            throw new Error('subprocess died')
          }
        })
      })
    }
    const h = makeService({ voiceEngine: 'local' }, { brain })
    const result = await h.service.ask('status?')
    expect(result).toEqual({ kind: 'answer', text: 'Adam fallback answer' })
    expect(h.fetchFn).toHaveBeenCalled()
  })

  it('keeps the partial answer when the brain dies mid-stream — no ADAM restatement', async () => {
    const localSpeak: LocalSpeakMock = vi.fn(async () => undefined)
    const brain = {
      ask: async function* (): AsyncIterable<string> {
        yield 'Spoken already.'
        throw new Error('mid-stream death')
      }
    }
    const h = makeService({ voiceEngine: 'local' }, { brain, localSpeak })
    const result = await h.service.ask('status?')
    expect(result).toEqual({ kind: 'answer', text: 'Spoken already.' })
    expect(h.fetchFn).not.toHaveBeenCalled()
  })

  it("voiceEngine 'elevenlabs' bypasses the brain entirely", async () => {
    const brain = { ask: vi.fn(() => sentences(['Should not stream.'])) }
    const h = makeService({ voiceEngine: 'elevenlabs' }, { brain })
    vi.stubEnv('ELEVENLABS_API_KEY', '')
    vi.stubEnv('ELEVENLABS_VOICE_ID', '')
    const result = await h.service.ask('status?')
    expect(brain.ask).not.toHaveBeenCalled()
    expect(result.kind).toBe('answer')
    expect(h.fetchFn).toHaveBeenCalled()
  })

  it('an empty brain stream falls back to ADAM', async () => {
    const brain = { ask: () => sentences([]) }
    const h = makeService({ voiceEngine: 'local' }, { brain })
    const result = await h.service.ask('status?')
    expect(result).toEqual({ kind: 'answer', text: 'Adam fallback answer' })
  })
})
