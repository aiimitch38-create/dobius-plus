import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceSettings } from '../../shared/speech-types'
import type { SpeakOutcome, SpeakRunner } from '../communications/huddles/huddle-speech-synthesis'
import { createHuddleSpeechQueue } from '../communications/huddles/huddle-speech-synthesis'
import type { SttEvent, SttEventSink } from '../speech/stt-service'
import {
  JARVIS_PTT_PRESSED_CHANNEL,
  JARVIS_PTT_RELEASED_CHANNEL,
  JARVIS_STATE_CHANNEL,
  JarvisService,
  isWakeSessionOwner,
  tapSttFinalTranscripts
} from './jarvis-service'
import type { JarvisBroadcastPort, JarvisShortcutPort } from './jarvis-service'
import { resetAdamServiceTokenCacheForTests } from './adam-client'

const BASE_VOICE: VoiceSettings = {
  enabled: false,
  sttModel: '',
  modelsDir: '',
  language: 'en',
  dictationMode: 'toggle',
  terminalConfirmBeforeInsert: false,
  userModels: [],
  openAiApiKeyConfigured: false,
  conductorEnabled: false,
  adamEndpoint: 'http://adam.test'
}

type TestHarness = {
  service: JarvisService
  broadcast: ReturnType<typeof vi.fn>
  registerShortcut: ReturnType<typeof vi.fn>
  unregisterShortcut: ReturnType<typeof vi.fn>
  speakQueue: ReturnType<typeof vi.fn>
  fetchFn: ReturnType<typeof vi.fn>
}

function makeHarness(voiceOverrides: Partial<VoiceSettings> = {}): TestHarness {
  const broadcast = vi.fn()
  const registerShortcut = vi.fn(() => true)
  const unregisterShortcut = vi.fn()
  const speakQueue = vi.fn<(text: string) => Promise<SpeakOutcome>>()
  speakQueue.mockResolvedValue({ played: true, engine: 'say' })
  const fetchFn = vi.fn<() => Promise<Response>>()
  fetchFn.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, result: { kind: 'answer', text: 'All good' } }), {
      status: 200
    })
  )
  const service = new JarvisService({
    store: {
      getSettings: () => ({ voice: { ...BASE_VOICE, ...voiceOverrides } })
    },
    broadcast: broadcast as unknown as JarvisBroadcastPort,
    shortcut: {
      register: registerShortcut as unknown as JarvisShortcutPort['register'],
      unregister: unregisterShortcut
    },
    fetchFn: fetchFn as unknown as typeof fetch,
    speakQueue
  })
  return { service, broadcast, registerShortcut, unregisterShortcut, speakQueue, fetchFn }
}

function statesOf(broadcast: ReturnType<typeof vi.fn>): string[] {
  return broadcast.mock.calls
    .filter(([channel]) => channel === JARVIS_STATE_CHANNEL)
    .map(([, payload]) => (payload as { state: string }).state)
}

beforeEach(() => {
  // Why a throwaway token path: ask() reads the machine-local ADAM token once;
  // pointing the env override at a temp location keeps tests off Carson's disk.
  process.env.DOBIUS_ADAM_TOKEN_PATH = join(mkdtempSync(join(tmpdir(), 'jarvis-test-')), 'token')
  resetAdamServiceTokenCacheForTests()
})

afterEach(() => {
  resetAdamServiceTokenCacheForTests()
  delete process.env.DOBIUS_ADAM_TOKEN_PATH
  vi.useRealTimers()
})

describe('JarvisService.toggle', () => {
  it('registers the shortcut only while mode is on, releases on off', () => {
    const h = makeHarness()
    expect(h.service.toggle(true)).toBe(true)
    expect(h.registerShortcut).toHaveBeenCalledTimes(1)
    expect(h.service.isShortcutActive()).toBe(true)

    h.service.toggle(false)
    expect(h.unregisterShortcut).toHaveBeenCalledTimes(1)
    expect(h.service.isShortcutActive()).toBe(false)
  })

  it('never touches the shortcut when toggled off from a fresh state', () => {
    const h = makeHarness()
    h.service.toggle(false)
    expect(h.registerShortcut).not.toHaveBeenCalled()
    expect(h.unregisterShortcut).not.toHaveBeenCalled()
    expect(statesOf(h.broadcast)).toEqual(['idle'])
  })

  it('is idempotent when already active', () => {
    const h = makeHarness()
    h.service.toggle(true)
    h.service.toggle(true)
    expect(h.registerShortcut).toHaveBeenCalledTimes(1)
  })

  it('surfaces an error state instead of silently failing when the accelerator is taken', () => {
    const h = makeHarness()
    h.registerShortcut.mockReturnValue(false)
    expect(h.service.toggle(true)).toBe(false)
    expect(h.service.isShortcutActive()).toBe(false)
    const lastPayload = h.broadcast.mock.calls.at(-1)?.[1] as { state: string; reason: string }
    expect(lastPayload.state).toBe('error')
    expect(lastPayload.reason).toBe('global-shortcut-unavailable')
  })
})

describe('push-to-talk events', () => {
  it('emits pressed immediately and released after 50ms, per activation', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    h.service.toggle(true)

    const handler = h.registerShortcut.mock.calls[0][0] as () => void

    handler()
    expect(h.broadcast).toHaveBeenNthCalledWith(2, JARVIS_PTT_PRESSED_CHANNEL, expect.anything())
    expect(
      h.broadcast.mock.calls.some(([channel]) => channel === JARVIS_PTT_RELEASED_CHANNEL)
    ).toBe(false)

    vi.advanceTimersByTime(50)
    expect(h.broadcast).toHaveBeenNthCalledWith(3, JARVIS_PTT_RELEASED_CHANNEL, expect.anything())

    handler()
    vi.advanceTimersByTime(50)
    expect(
      h.broadcast.mock.calls.filter(([channel]) => channel === JARVIS_PTT_PRESSED_CHANNEL)
    ).toHaveLength(2)
    expect(
      h.broadcast.mock.calls.filter(([channel]) => channel === JARVIS_PTT_RELEASED_CHANNEL)
    ).toHaveLength(2)
  })
})

describe('JarvisService.ask', () => {
  it('asks ADAM, speaks the answer, and walks thinking → speaking → idle', async () => {
    const h = makeHarness()
    const result = await h.service.ask('what is shipping today')

    expect(result).toEqual({ kind: 'answer', text: 'All good' })
    expect(h.speakQueue).toHaveBeenCalledWith('All good')
    expect(statesOf(h.broadcast)).toEqual(['thinking', 'speaking', 'idle'])
    expect(h.fetchFn).toHaveBeenCalledWith(
      'http://adam.test/v1/converse',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('maps network failure to unreachable without speaking and returns to idle', async () => {
    const h = makeHarness()
    h.fetchFn.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(h.service.ask('hello')).resolves.toEqual({
      kind: 'error',
      text: 'ADAM is unreachable'
    })
    expect(h.speakQueue).not.toHaveBeenCalled()
    expect(statesOf(h.broadcast)).toEqual(['thinking', 'idle'])
  })

  it('does not hit ADAM for blank utterances', async () => {
    const h = makeHarness()
    await expect(h.service.ask('   ')).resolves.toEqual({
      kind: 'error',
      text: 'No speech detected'
    })
    expect(h.fetchFn).not.toHaveBeenCalled()
    expect(statesOf(h.broadcast)).toEqual([])
  })
})

describe('JarvisService.speak serialization', () => {
  it('routes overlapping calls through one queue so audio never overlaps', async () => {
    const timeline: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    let callCount = 0
    const runner: SpeakRunner = async (_command, args) => {
      const text = args.at(-1) ?? ''
      const isFirst = callCount === 0
      callCount += 1
      timeline.push(`enter:${text}`)
      if (isFirst) {
        await gate
        timeline.push(`exit:${text}`)
        return
      }
      timeline.push(`exit:${text}`)
    }

    const realQueue = createHuddleSpeechQueue('darwin', runner)
    const h = makeHarness()
    h.speakQueue.mockImplementation(realQueue)

    const first = h.service.speak('first utterance')
    await vi.waitFor(() => expect(timeline).toEqual(['enter:first utterance']))

    const second = h.service.speak('second utterance')
    await vi.waitFor(() =>
      expect(timeline).toEqual(['enter:first utterance'])
    )

    release()
    await Promise.all([first, second])

    expect(timeline).toEqual([
      'enter:first utterance',
      'exit:first utterance',
      'enter:second utterance',
      'exit:second utterance'
    ])
  })

  it('reports empty text without touching the queue or emitting phases', async () => {
    const h = makeHarness()
    await expect(h.service.speak('  ')).resolves.toEqual({ played: false, reason: 'empty text' })
    expect(h.speakQueue).not.toHaveBeenCalled()
    expect(statesOf(h.broadcast)).toEqual([])
  })
})

describe('wake-word ambient mode', () => {
  it('ignores transcripts while the experimental flag is off', () => {
    const h = makeHarness()
    h.service.handleAmbientTranscript('hey adam status')
    expect(h.fetchFn).not.toHaveBeenCalled()
  })

  it('fires an ask when enabled and the wake phrase carries an utterance', async () => {
    const h = makeHarness({ ...BASE_VOICE, jarvisWakeWord: true })
    h.service.handleAmbientTranscript('hey adam what is shipping')

    await vi.waitFor(() => expect(h.fetchFn).toHaveBeenCalled())
    const [url, init] = h.fetchFn.mock.calls[0] as [string, { body: string }]
    expect(url).toBe('http://adam.test/v1/converse')
    expect(JSON.parse(init.body)).toEqual({ utterance: 'what is shipping' })
  })
})

describe('tapSttFinalTranscripts', () => {
  function makeFakeStt() {
    let sink: SttEventSink | null = null
    const startSpy = vi.fn(
      async (_modelId: string, nextSink: SttEventSink, ..._rest: unknown[]): Promise<void> => {
        sink = nextSink
      }
    )
    return {
      stt: { startDictation: startSpy },
      startSpy,
      emit(event: SttEvent): void {
        sink?.(event)
      }
    }
  }

  it('forwards finals to the observer without hiding them from the owner', async () => {
    const { stt, emit } = makeFakeStt()
    const owned: string[] = []
    const seen: string[] = []
    tapSttFinalTranscripts(stt, (text) => seen.push(text))

    await stt.startDictation('model-a', (event) => {
      if (event.type === 'final') {
        owned.push(event.text ?? '')
      }
    })
    emit({ type: 'partial', text: 'hey' })
    emit({ type: 'final', text: 'hey adam status' })
    emit({ type: 'stopped' })

    expect(seen).toEqual(['hey adam status'])
    expect(owned).toEqual(['hey adam status'])
  })

  it('wraps each dictation start so re-armed sessions keep feeding the observer', async () => {
    const { stt, startSpy, emit } = makeFakeStt()
    const seen: string[] = []
    tapSttFinalTranscripts(stt, (text) => seen.push(text))

    await stt.startDictation('model-a', () => {})
    await stt.startDictation('model-b', () => {})
    emit({ type: 'final', text: 'second session words' })

    expect(seen).toEqual(['second session words'])
    expect(startSpy).toHaveBeenCalledTimes(2)
  })

  it('guards against double-tapping the same instance', async () => {
    const { stt, emit } = makeFakeStt()
    const seen: string[] = []
    const untapFirst = tapSttFinalTranscripts(stt, (text) => seen.push(`first:${text}`))
    tapSttFinalTranscripts(stt, (text) => seen.push(`second:${text}`))

    await stt.startDictation('model-a', () => {})
    emit({ type: 'final', text: 'once' })

    expect(seen).toEqual(['first:once'])
    untapFirst()
  })

  it('ownerFilter keeps ordinary dictation finals from arming the wake matcher', async () => {
    const { stt, emit } = makeFakeStt()
    const seen: string[] = []
    tapSttFinalTranscripts(stt, (text) => seen.push(text), {
      ownerFilter: isWakeSessionOwner
    })

    const ownerSink = (): void => undefined
    // Ordinary ⌘E session: owner `desktop:<id>:<n>` — must NOT feed the matcher.
    await stt.startDictation('model-a', ownerSink, undefined, 'desktop:42:3')
    emit({ type: 'final', text: 'hey adam write a poem' })
    // Wake ambient session: `desktop:<id>:wake` — must feed it.
    await stt.startDictation('model-a', ownerSink, undefined, 'desktop:42:wake')
    emit({ type: 'final', text: 'hey adam status' })
    // Mobile runtime session must never feed either.
    await stt.startDictation('model-a', ownerSink, undefined, 'mobile:wake')
    emit({ type: 'final', text: 'hey adam again' })

    expect(seen).toEqual(['hey adam status'])
  })
})
