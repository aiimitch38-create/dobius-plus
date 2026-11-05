import type { CharacterState } from 'orb-character'
import type { DictationState } from '../../../../shared/speech-types'

export type JarvisOrbState = CharacterState | 'error'
export type VoiceAgentOrbState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'
export type VoiceOrbActivitySource = 'input' | 'output' | 'preview'

export type VoiceOrbPresentation = {
  state: CharacterState
  activitySource: VoiceOrbActivitySource
}

type VoiceOrbPresentationInput = {
  dictationState: DictationState
  jarvisState: JarvisOrbState
  agentMode: boolean
  agentState: VoiceAgentOrbState
}

const IDLE_PRESENTATION: VoiceOrbPresentation = { state: 'idle', activitySource: 'preview' }

function presentation(
  state: CharacterState,
  activitySource: VoiceOrbActivitySource = 'preview'
): VoiceOrbPresentation {
  return { state, activitySource }
}

/**
 * Resolves the one visible character from competing voice features. Dictation
 * owns the microphone first, then a configured live agent, then Jarvis turns.
 */
export function resolveVoiceOrbPresentation({
  dictationState,
  jarvisState,
  agentMode,
  agentState
}: VoiceOrbPresentationInput): VoiceOrbPresentation {
  if (dictationState === 'starting' || dictationState === 'listening') {
    return presentation('listening', 'input')
  }
  if (dictationState === 'stopping') {
    return presentation('thinking')
  }

  if (agentMode) {
    if (agentState === 'listening') {
      return presentation('listening', 'input')
    }
    if (agentState === 'speaking') {
      return presentation('speaking', 'output')
    }
    if (agentState === 'connecting') {
      return presentation('thinking')
    }
    return IDLE_PRESENTATION
  }

  if (jarvisState === 'listening') {
    return presentation('listening', 'input')
  }
  if (jarvisState === 'thinking') {
    return presentation('thinking')
  }
  if (jarvisState === 'speaking') {
    return presentation('speaking')
  }
  return IDLE_PRESENTATION
}
