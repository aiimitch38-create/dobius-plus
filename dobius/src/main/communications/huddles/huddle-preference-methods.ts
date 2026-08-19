/**
 * RPC methods for per-huddle preference toggles and text-to-speech.
 *
 * Audio *output device* selection (`get/set/list_audio_output_devices`) is
 * deliberately NOT here — see PER_COMMAND in the build report. The renderer
 * already has real device enumeration via `navigator.mediaDevices` (used by
 * `useAudioDevices.ts` for input devices in this same feature) and Electron's
 * main process has no equivalent API for output devices without a native
 * module, so those three commands are handled entirely client-side.
 */
import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../../runtime/rpc/core'
import { requiredString } from '../../runtime/rpc/schemas'
import { getHuddleSessionStore } from './huddle-session-store'
import { getHuddleSpeechQueue, type SpeakOutcome } from './huddle-speech-synthesis'

// Literal union kept in sync with VoiceInputMode in huddle-session-store.ts —
// z.enum needs its own literal tuple, so this is the single source for it.
const VOICE_INPUT_MODES = ['push_to_talk', 'voice_activity'] as const

const VoiceInputModeParams = z.object({
  mode: z.enum(VOICE_INPUT_MODES)
})

const EnabledParams = z.object({
  enabled: z.boolean()
})

const SpeakParams = z.object({
  text: requiredString('Missing text to speak')
})

export const HUDDLE_PREFERENCE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'huddle.setVoiceInputMode',
    params: VoiceInputModeParams,
    handler: (params) => getHuddleSessionStore().setVoiceInputMode(params.mode)
  }),
  defineMethod({
    name: 'huddle.getVoiceInputMode',
    params: null,
    handler: () => getHuddleSessionStore().getState().voice_input_mode
  }),
  defineMethod({
    name: 'huddle.setTranscriptionEnabled',
    params: EnabledParams,
    handler: (params) => getHuddleSessionStore().setTranscriptionEnabled(params.enabled)
  }),
  defineMethod({
    name: 'huddle.setTtsEnabled',
    params: EnabledParams,
    handler: (params) => getHuddleSessionStore().setTtsEnabled(params.enabled)
  }),
  defineMethod({
    name: 'huddle.speak',
    params: SpeakParams,
    handler: async (params): Promise<SpeakOutcome> => {
      // Server-side mute check: honors a TTS-off toggle flipped a moment
      // ago even if a speak call was already in flight from the client.
      if (!getHuddleSessionStore().getState().tts_enabled) {
        return { played: false, reason: 'tts_disabled' }
      }
      return getHuddleSpeechQueue()(params.text)
    }
  })
]
