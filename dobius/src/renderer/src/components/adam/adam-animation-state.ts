import type { CharacterState } from 'orb-character'
import type { VoiceOrbPresentation } from '../dictation/voice-orb-state'
import type { PetAnimationName } from '../pet/pet-agent-state'

/**
 * Adam's roaming body reuses the same four states the orb character
 * supports. Voice activity (listening/thinking/speaking) always wins —
 * it's what Carson is doing right now. When voice is idle, the orb falls
 * back to reflecting live agent work, so Adam visibly "notices" an agent
 * that needs attention even when nobody's talking to him.
 */
export function resolveAdamCharacterState(
  voicePresentation: VoiceOrbPresentation,
  agentAnimation: PetAnimationName
): CharacterState {
  if (voicePresentation.state !== 'idle') {
    return voicePresentation.state
  }
  if (agentAnimation === 'waiting') {
    return 'listening'
  }
  if (agentAnimation === 'running' || agentAnimation === 'review') {
    return 'thinking'
  }
  return 'idle'
}
