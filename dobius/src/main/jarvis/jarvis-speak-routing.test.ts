import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { SpeakOutcome } from '../communications/huddles/huddle-speech-synthesis'
import type { VoiceSettings } from '../../shared/speech-types'
import { JarvisService } from './jarvis-service'

type LocalSpeakMock = Mock<(text: string) => Promise<void>>

function makeService(voice: Partial<VoiceSettings>, opts: { localSpeak?: LocalSpeakMock; fetchFn?: typeof fetch } = {}): {
  service: JarvisService
  speakQueue: ReturnType<typeof vi.fn>
  fetchFn: ReturnType<typeof vi.fn>
} {
  const speakQueue = vi.fn<(text: string) => Promise<SpeakOutcome>>()
  speakQueue.mockResolvedValue({ played: true, engine: 'say' })
  const fetchFn = vi.fn()
  const service = new JarvisService({
    store: { getSettings: () => ({ voice: voice as VoiceSettings }) },
    broadcast: vi.fn(),
    shortcut: { register: () => true, unregister: () => undefined },
    fetchFn: (opts.fetchFn ?? fetchFn) as typeof fetch,
    speakQueue,
    localSpeak: opts.localSpeak
  })
  return { service, speakQueue, fetchFn }
}

describe('jarvis speak routing decision table', () => {
  it("voiceEngine 'local' with a localSpeak dep → local plays, say queue untouched", async () => {
    const localSpeak: LocalSpeakMock = vi.fn(async () => undefined)
    const h = makeService({ voiceEngine: 'local' }, { localSpeak })
    await expect(h.service.speak('Hello there.')).resolves.toEqual({ played: true })
    expect(localSpeak).toHaveBeenCalledWith('Hello there.')
    expect(h.speakQueue).not.toHaveBeenCalled()
  })

  it('voiceEngine unset defaults to local', async () => {
    const localSpeak: LocalSpeakMock = vi.fn(async () => undefined)
    const h = makeService({}, { localSpeak })
    await h.service.speak('Default path.')
    expect(localSpeak).toHaveBeenCalled()
    expect(h.speakQueue).not.toHaveBeenCalled()
  })

  it('local failure falls back to the say queue — never silence', async () => {
    const localSpeak: LocalSpeakMock = vi.fn(async () => {
      throw new Error('model download failed')
    })
    const h = makeService({ voiceEngine: 'local' }, { localSpeak })
    await expect(h.service.speak('Fallback please.')).resolves.toEqual({ played: true })
    expect(h.speakQueue).toHaveBeenCalledWith('Fallback please.')
  })

  it('local mode without a localSpeak dep goes straight to the say queue', async () => {
    const h = makeService({ voiceEngine: 'local' })
    await h.service.speak('No local engine wired.')
    expect(h.speakQueue).toHaveBeenCalled()
  })

  it("voiceEngine 'elevenlabs' never calls localSpeak, even when wired", async () => {
    const localSpeak: LocalSpeakMock = vi.fn(async () => undefined)
    // Blank out any ambient credentials so the config resolves null → say
    // queue, with no network call from the test runner's real environment.
    vi.stubEnv('ELEVENLABS_API_KEY', '')
    vi.stubEnv('ELEVENLABS_VOICE_ID', '')
    const h = makeService({ voiceEngine: 'elevenlabs' }, { localSpeak })
    await h.service.speak('Billed path.')
    expect(localSpeak).not.toHaveBeenCalled()
    expect(h.speakQueue).toHaveBeenCalled()
  })
})
