import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { DictationState, SpeechModelState } from '../../../../shared/speech-types'

export type DictationSlice = {
  dictationState: DictationState
  partialTranscript: string
  activeModelId: string | null
  modelStates: SpeechModelState[]
  /** Current "Listening…"/"Thinking…"/"Speaking…" label for the app's one
   *  voice orb, published by DictationIndicator (the sole mounted owner of
   *  ⌘E/⌘T/live-agent state) so other renderers of the orb — the floating
   *  terminal dock — can show it without re-deriving three separate state
   *  machines themselves. Null when nothing is active. */
  voiceOrbLabel: string | null
  setDictationState: (state: DictationState) => void
  setPartialTranscript: (text: string) => void
  setActiveModelId: (id: string | null) => void
  setModelStates: (states: SpeechModelState[]) => void
  setVoiceOrbLabel: (label: string | null) => void
  refreshModelStates: () => Promise<void>
}

export const createDictationSlice: StateCreator<AppState, [], [], DictationSlice> = (set) => ({
  dictationState: 'idle',
  partialTranscript: '',
  activeModelId: null,
  modelStates: [],
  voiceOrbLabel: null,

  setDictationState: (state) => set({ dictationState: state }),
  setPartialTranscript: (text) => set({ partialTranscript: text }),
  setActiveModelId: (id) => set({ activeModelId: id }),
  setModelStates: (states) => set({ modelStates: states }),
  setVoiceOrbLabel: (label) => set({ voiceOrbLabel: label }),

  refreshModelStates: async () => {
    try {
      const states = await window.api.speech.getModelStates()
      set({ modelStates: states })
    } catch (err) {
      console.error('Failed to fetch model states:', err)
    }
  }
})
