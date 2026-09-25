// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceSettings } from '../../../../shared/speech-types'
import { JARVIS_NO_MODEL_TEXT, useJarvisTurn, type JarvisTurn } from './use-jarvis-turn'

const toastMock = vi.hoisted(() => vi.fn())
const storeActions = vi.hoisted(() => ({
  openSettingsTarget: vi.fn(),
  openSettingsPage: vi.fn()
}))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => storeActions }
}))

let root: Root | null = null
let container: HTMLDivElement | null = null
let latest: JarvisTurn | null = null
let renderCount = 0
let pushSettings: ((updates: { voice?: VoiceSettings }) => void) | null = null
let pttPressed: (() => void) | null = null
let trackStop: ReturnType<typeof vi.fn>
let getUserMedia: ReturnType<typeof vi.fn>
let startDictation: ReturnType<typeof vi.fn>
let stopDictation: ReturnType<typeof vi.fn>

function Probe(): null {
  renderCount += 1
  latest = useJarvisTurn()
  return null
}

class FakeAudioContext {
  state = 'running'
  sampleRate = 48_000
  destination = {}
  createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
    return { connect: () => undefined, disconnect: () => undefined }
  }
  createScriptProcessor(): {
    connect: () => void
    disconnect: () => void
    onaudioprocess: unknown
  } {
    return { connect: () => undefined, disconnect: () => undefined, onaudioprocess: null }
  }
  resume(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.state = 'closed'
    return Promise.resolve()
  }
}

function installApi(voice: VoiceSettings): void {
  const noopUnsubscribe = (): (() => void) => () => undefined
  ;(window as unknown as { api: unknown }).api = {
    settings: {
      get: vi.fn(async () => ({ voice })),
      onChanged: vi.fn((listener: (updates: { voice?: VoiceSettings }) => void) => {
        pushSettings = listener
        return () => {
          pushSettings = null
        }
      })
    },
    speech: {
      startDictation,
      stopDictation,
      feedAudio: vi.fn(async () => undefined),
      onPartialTranscript: vi.fn(noopUnsubscribe),
      onFinalTranscript: vi.fn(noopUnsubscribe),
      onStopped: vi.fn(noopUnsubscribe),
      onError: vi.fn(noopUnsubscribe)
    },
    jarvis: {
      onState: vi.fn(noopUnsubscribe),
      onPttPressed: vi.fn((listener: () => void) => {
        pttPressed = listener
        return () => {
          pttPressed = null
        }
      }),
      onPttReleased: vi.fn(noopUnsubscribe),
      ask: vi.fn(),
      speak: vi.fn()
    }
  }
}

async function renderProbe(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<Probe />)
  })
}

beforeEach(() => {
  renderCount = 0
  latest = null
  pushSettings = null
  pttPressed = null
  trackStop = vi.fn()
  getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] }))
  startDictation = vi.fn(async () => undefined)
  stopDictation = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia }
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

describe('useJarvisTurn lifecycle (#82)', () => {
  it('keeps a listening turn alive across unrelated re-renders', async () => {
    installApi({ jarvisEnabled: true, sttModel: 'model-a' } as VoiceSettings)
    await renderProbe()
    expect(pttPressed).not.toBeNull()

    await act(async () => {
      pttPressed?.()
    })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(startDictation).toHaveBeenCalledWith('model-a', undefined, '1')
    expect(latest?.hudState).toBe('listening')

    // A settings push re-renders the hook while the turn owns the mic.
    const rendersBefore = renderCount
    await act(async () => {
      pushSettings?.({ voice: { jarvisEnabled: true, sttModel: 'model-a' } as VoiceSettings })
    })
    await act(async () => {
      pushSettings?.({ voice: { jarvisEnabled: true, sttModel: 'model-b' } as VoiceSettings })
    })
    expect(renderCount).toBeGreaterThan(rendersBefore)

    expect(stopDictation).not.toHaveBeenCalled()
    expect(trackStop).not.toHaveBeenCalled()
    expect(latest?.hudState).toBe('listening')
  })

  it('still tears the session down on unmount', async () => {
    installApi({ jarvisEnabled: true, sttModel: 'model-a' } as VoiceSettings)
    await renderProbe()
    await act(async () => {
      pttPressed?.()
    })
    expect(latest?.hudState).toBe('listening')

    await act(async () => {
      root?.unmount()
    })
    root = null

    expect(stopDictation).toHaveBeenCalledWith('1')
    expect(trackStop).toHaveBeenCalled()
  })
})

describe('useJarvisTurn missing model (#88)', () => {
  it('reports a specific, actionable status without opening capture', async () => {
    installApi({ jarvisEnabled: true, sttModel: '' } as VoiceSettings)
    await renderProbe()

    await act(async () => {
      latest?.toggleTurn()
    })

    expect(latest?.hudState).toBe('error')
    expect(latest?.errorText).toBe(JARVIS_NO_MODEL_TEXT)
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(startDictation).not.toHaveBeenCalled()

    expect(toastMock).toHaveBeenCalledTimes(1)
    const [message, options] = toastMock.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } }
    ]
    expect(message).toBe(JARVIS_NO_MODEL_TEXT)
    options.action.onClick()
    expect(storeActions.openSettingsTarget).toHaveBeenCalledWith({ pane: 'voice', repoId: null })
    expect(storeActions.openSettingsPage).toHaveBeenCalledTimes(1)
  })
})
