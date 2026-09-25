// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DictationState } from '../../../../shared/speech-types'

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), message: vi.fn() }))
const storeState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>
}))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(storeState.current),
    { getState: () => storeState.current }
  )
}))
vi.mock('./DictationIndicator', () => ({ DictationIndicator: () => null }))

import { DictationController } from './DictationController'

type FakeProcessor = {
  connect: () => void
  disconnect: () => void
  onaudioprocess: ((event: unknown) => void) | null
}

const processors: FakeProcessor[] = []

class FakeAudioContext {
  state = 'running'
  sampleRate = 48_000
  destination = {}
  createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
    return { connect: () => undefined, disconnect: () => undefined }
  }
  createScriptProcessor(): FakeProcessor {
    const processor: FakeProcessor = {
      connect: () => undefined,
      disconnect: () => undefined,
      onaudioprocess: null
    }
    processors.push(processor)
    return processor
  }
  resume(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.state = 'closed'
    return Promise.resolve()
  }
}

const originalUserAgent = navigator.userAgent
let root: Root | null = null
let container: HTMLDivElement | null = null
let dictationKeyDown: (() => void) | null = null
let states: DictationState[] = []
let feedAudio: ReturnType<typeof vi.fn>
let stopDictation: ReturnType<typeof vi.fn>

beforeEach(() => {
  processors.length = 0
  states = []
  dictationKeyDown = null
  storeState.current = {
    dictationState: 'idle',
    setDictationState: (state: DictationState) => {
      states.push(state)
      storeState.current.dictationState = state
    },
    setPartialTranscript: vi.fn(),
    recordFeatureInteraction: vi.fn(),
    settings: { voice: { enabled: true, sttModel: 'openai-model', dictationMode: 'toggle' } },
    keybindings: {},
    openSettingsTarget: vi.fn(),
    openSettingsPage: vi.fn()
  }
  feedAudio = vi.fn(async () => undefined)
  stopDictation = vi.fn(async () => undefined)
  const unsubscribe = (): (() => void) => () => undefined
  ;(window as unknown as { api: unknown }).api = {
    ui: {
      onDictationKeyDown: (listener: () => void) => {
        dictationKeyDown = listener
        return () => {
          dictationKeyDown = null
        }
      }
    },
    speech: {
      startDictation: vi.fn(async () => undefined),
      stopDictation,
      feedAudio,
      onPartialTranscript: unsubscribe,
      onFinalTranscript: unsubscribe,
      onStopped: unsubscribe,
      onError: unsubscribe
    }
  }
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) }
  })
  vi.stubGlobal('AudioContext', FakeAudioContext)
})

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
  }
  root = null
  container?.remove()
  container = null
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('DictationController', () => {
  it('stops visibly when main rejects live audio at the cloud limit (#85)', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<DictationController />)
    })

    await act(async () => {
      dictationKeyDown?.()
    })
    expect(states.at(-1)).toBe('listening')

    feedAudio.mockRejectedValue(
      new Error(
        "Error invoking remote method 'speech:feedAudio': Error: Cloud transcription is limited to 10 minutes per dictation"
      )
    )
    await act(async () => {
      processors.at(-1)?.onaudioprocess?.({
        inputBuffer: { getChannelData: () => new Float32Array(4096) }
      })
    })

    expect(toastMock.error).toHaveBeenCalledWith(
      'Dictation stopped: Cloud transcription is limited to 10 minutes per dictation'
    )
    expect(states).toContain('stopping')
    expect(stopDictation).toHaveBeenCalledWith('1')
  })
  it('keeps a held dictation recording through a theme change until release (#92)', async () => {
    const voice = { enabled: true, sttModel: 'openai-model', dictationMode: 'hold' }
    storeState.current = { ...storeState.current, settings: { voice, theme: 'dark' } }
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'
    })
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    input.focus()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<DictationController />)
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', metaKey: true }))
    })
    expect(states.at(-1)).toBe('listening')

    storeState.current = {
      ...storeState.current,
      settings: { voice: { ...voice }, theme: 'light' }
    }
    await act(async () => {
      root?.render(<DictationController />)
    })

    expect(stopDictation).not.toHaveBeenCalled()
    expect(states.at(-1)).toBe('listening')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'e', code: 'KeyE' }))
    })
    expect(stopDictation).toHaveBeenCalledWith('1')
    input.remove()
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUserAgent })
  })
})
