// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultVoiceSettings } from '../../../../shared/constants'
import type { VoiceSettings } from '../../../../shared/speech-types'

type StoreState = { settings: { voice?: VoiceSettings } | null }
const store = vi.hoisted(() => {
  const listeners = new Set<(state: StoreState, prev: StoreState) => void>()
  let state: StoreState = { settings: null }
  return {
    getState: () => state,
    setState: (next: StoreState) => {
      const prev = state
      state = next
      listeners.forEach((listener) => listener(state, prev))
    },
    subscribe: (listener: (state: StoreState, prev: StoreState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reset: () => {
      listeners.clear()
      state = { settings: null }
    }
  }
})
vi.mock('@/store', () => ({ useAppStore: store }))

import { useJarvisVoiceSettings, type JarvisVoiceFlags } from './use-jarvis-voice-settings'

const keyed = (patch: Partial<VoiceSettings>): VoiceSettings => ({
  ...getDefaultVoiceSettings(),
  jarvisEnabled: true,
  openAiApiKeyConfigured: true,
  ...patch
})

let root: Root | null = null
let latest: JarvisVoiceFlags | null = null

function Probe(): null {
  latest = useJarvisVoiceSettings().flags
  return null
}

beforeEach(() => {
  store.reset()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Object.assign(window, {
    api: {
      settings: {
        get: vi.fn(async () => ({ voice: keyed({ liveVoiceEngine: 'hermes' }) })),
        // Why a no-op: main never echoes a change back to the window that made it.
        onChanged: vi.fn(() => () => undefined)
      }
    }
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  latest = null
})

describe('useJarvisVoiceSettings', () => {
  it('follows an engine change made in this same window (Settings > Voice)', async () => {
    const container = document.createElement('div')
    root = createRoot(container)
    await act(async () => {
      root!.render(<Probe />)
    })
    expect(latest?.activeVoiceEngine).toBe('hermes')

    act(() => store.setState({ settings: { voice: keyed({ liveVoiceEngine: 'openai-live' }) } }))
    expect(latest?.activeVoiceEngine).toBe('openai-live')
  })
})
