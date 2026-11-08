// @vitest-environment happy-dom

import { act, memo } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAVED_PRESETS, type OrbCharacterProps } from 'orb-character'
import type { DictationState } from '../../../../shared/speech-types'
import type { JarvisTurn } from '../jarvis/use-jarvis-turn'
import type { VoiceAgent } from '../jarvis/use-voice-agent'
import { DictationIndicator } from './DictationIndicator'
import { VoiceOrb } from './VoiceOrb'
import { getVoiceOrbPresentation, voiceOrbLevelSource } from './voice-orb-live-level'

const voice = vi.hoisted(() => ({
  dictationState: 'idle' as DictationState,
  setLabel: vi.fn(),
  jarvis: {} as JarvisTurn,
  agent: {} as VoiceAgent,
  flags: { jarvisEnabled: true, agentId: '' },
  props: {} as OrbCharacterProps
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      dictationState: voice.dictationState,
      partialTranscript: '',
      setVoiceOrbLabel: voice.setLabel
    })
}))
vi.mock('../jarvis/use-jarvis-turn', () => ({ useJarvisTurn: () => voice.jarvis }))
vi.mock('../jarvis/use-voice-agent', () => ({ useVoiceAgent: () => voice.agent }))
vi.mock('../jarvis/use-jarvis-voice-settings', () => ({
  useJarvisVoiceSettings: () => ({ flags: voice.flags })
}))
vi.mock('orb-character', () => ({
  SAVED_PRESETS: Object.freeze({}),
  OrbCharacter: (props: OrbCharacterProps) => {
    voice.props = props
    return <div data-character={props.state} />
  }
}))

let root: Root
let container: HTMLDivElement
let frames: Map<number, FrameRequestCallback>
const dictationLevel = vi.fn(() => 0.2)
const readLevel = (): number => voiceOrbLevelSource.current()
// The dock must update through its subscription, even when its parent does not render.
const DockCharacter = memo(VoiceOrb)

async function render(dock = true): Promise<void> {
  await act(async () => {
    root.render(
      <>
        <DictationIndicator getAudioLevel={dictationLevel} />
        {dock ? <DockCharacter size={36} getLevel={readLevel} /> : null}
      </>
    )
  })
}

async function tick(): Promise<void> {
  const pending = [...frames.values()]
  frames.clear()
  await act(async () => pending.forEach((frame) => frame(0)))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  frames = new Map()
  let frameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  voice.dictationState = 'idle'
  voice.flags = { jarvisEnabled: true, agentId: '' }
  voice.jarvis = {
    hudState: 'idle',
    wakeArmed: false,
    ambientActive: false,
    errorText: null,
    getAudioLevel: vi.fn(() => 0.4),
    toggleTurn: vi.fn()
  }
  voice.agent = {
    state: 'idle',
    active: false,
    errorText: null,
    toggle: vi.fn(),
    getInputLevel: vi.fn(() => 0.6),
    getOutputLevel: vi.fn(() => 0.8)
  }
  window.api = { jarvis: { onPttPressed: vi.fn(() => vi.fn()) } } as unknown as typeof window.api
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('the single dock character', () => {
  it('keeps the coordinator invisible and its live-agent shortcut mounted', async () => {
    voice.flags.agentId = 'agent'
    await render(false)
    expect(container.childElementCount).toBe(0)
    const subscribe = vi.mocked(window.api.jarvis.onPttPressed)
    expect(subscribe).toHaveBeenCalledTimes(1)
    subscribe.mock.calls[0][0]({ at: 0 })
    expect(voice.agent.toggle).toHaveBeenCalledTimes(1)
  })

  it('renders one face using the saved presets and the dictation microphone', async () => {
    voice.dictationState = 'listening'
    voice.flags.agentId = 'agent'
    voice.agent.state = 'speaking'
    await render()
    expect(container.querySelectorAll('[data-character]')).toHaveLength(1)
    expect(voice.props).toMatchObject({ form: 'face', state: 'listening', activity: 0.2 })
    expect(voice.props.presets).toBe(SAVED_PRESETS)
    expect(voice.agent.getOutputLevel).not.toHaveBeenCalled()
    expect(voice.jarvis.getAudioLevel).not.toHaveBeenCalled()
  })

  it('updates the audio owner even when both owners publish Listening...', async () => {
    voice.jarvis.hudState = 'listening'
    await render()
    expect(voice.props.activity).toBe(0.4)
    voice.jarvis.hudState = 'idle'
    voice.flags.agentId = 'agent'
    voice.agent.state = 'listening'
    await render()
    await tick()
    expect(voice.props.activity).toBe(0.6)
    expect(voice.setLabel.mock.calls.map(([label]) => label)).toEqual(['Listening...'])
  })

  it('switches from Jarvis speech preview to live output without a caption change', async () => {
    voice.jarvis.hudState = 'speaking'
    await render()
    expect(voice.props.activity).toBeUndefined()
    voice.flags.agentId = 'agent'
    voice.agent.state = 'speaking'
    await render()
    expect(voice.props).toMatchObject({ state: 'speaking', activity: 0.8 })
    expect(voice.setLabel.mock.calls.map(([label]) => label)).toEqual(['Speaking...'])
  })

  it('routes live input and output separately, including real silence', async () => {
    voice.flags.agentId = 'agent'
    voice.agent.state = 'listening'
    await render()
    expect(voice.props).toMatchObject({ state: 'listening', activity: 0.6 })
    expect(voice.agent.getOutputLevel).not.toHaveBeenCalled()
    vi.mocked(voice.agent.getInputLevel).mockClear()
    voice.agent.state = 'speaking'
    await render()
    expect(voice.props).toMatchObject({ state: 'speaking', activity: 0.8 })
    expect(voice.agent.getInputLevel).not.toHaveBeenCalled()
    vi.mocked(voice.agent.getOutputLevel).mockReturnValue(0)
    await tick()
    expect(voice.props.activity).toBe(0)
  })

  it.each(['thinking', 'speaking', 'idle', 'error'] as const)(
    'reacts to the Jarvis %s lifecycle without relying on caption changes',
    async (phase) => {
      await render()
      voice.jarvis.hudState = phase
      await render()
      expect(voice.props.state).toBe(phase === 'error' ? 'idle' : phase)
      expect(voice.props.activity).toBeUndefined()
      expect(dictationLevel).not.toHaveBeenCalled()
    }
  )

  it('clears the published state and stops polling on unmount', async () => {
    voice.flags.agentId = 'agent'
    voice.agent.state = 'speaking'
    await render()
    await act(async () => root.render(null))
    expect(getVoiceOrbPresentation()).toEqual({ state: 'idle', activitySource: 'preview' })
    expect(voiceOrbLevelSource.current()).toBe(0)
    expect(voice.setLabel).toHaveBeenLastCalledWith(null)
    expect(frames.size).toBe(0)
  })
})
