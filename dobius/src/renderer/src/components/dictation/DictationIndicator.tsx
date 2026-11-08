import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { useJarvisTurn } from '../jarvis/use-jarvis-turn'
import { useJarvisVoiceSettings } from '../jarvis/use-jarvis-voice-settings'
import { useVoiceAgent } from '../jarvis/use-voice-agent'
import { voiceOrbLevelSource, publishVoiceOrbPresentation } from './voice-orb-live-level'
import { resolveVoiceOrbPresentation } from './voice-orb-state'

type DictationIndicatorProps = {
  /** Current mic level, 0..1, polled by the orb once per frame. */
  getAudioLevel: () => number
}

/**
 * Coordinates dictation, Jarvis, and live-agent voice state for the dock.
 * The character intentionally lives only in the dock, not as a draggable HUD.
 */
export function DictationIndicator({ getAudioLevel }: DictationIndicatorProps) {
  const dictationState = useAppStore((s) => s.dictationState)
  const partialTranscript = useAppStore((s) => s.partialTranscript)
  const setVoiceOrbLabel = useAppStore((s) => s.setVoiceOrbLabel)
  const jarvis = useJarvisTurn()
  const agent = useVoiceAgent()
  const toggleAgent = agent.toggle
  const { flags } = useJarvisVoiceSettings()
  const agentMode = flags.jarvisEnabled && flags.agentId !== ''

  // ⌘T reaches this window as a Jarvis press event; in live mode it opens or
  // closes the conversation instead of starting a single turn.
  useEffect(() => {
    if (!agentMode) {
      return
    }
    return window.api.jarvis.onPttPressed(toggleAgent)
  }, [toggleAgent, agentMode])

  const agentActive = agentMode
  const jarvisActive = !agentMode && jarvis.hudState !== 'idle'
  const dictationActive =
    dictationState === 'listening' || dictationState === 'starting' || dictationState === 'stopping'
  // Why separate from agentActive: agentActive is true the instant a live
  // agent is merely *configured*, at rest, forever. This is true only while
  // an actual agent turn is in progress.
  const agentGenuinelyActive = agentActive && agent.state !== 'idle'

  const dictationLabel =
    dictationState === 'starting'
      ? 'Starting...'
      : dictationState === 'stopping'
        ? 'Processing...'
        : partialTranscript || 'Listening...'

  const jarvisLabel =
    jarvis.hudState === 'thinking'
      ? 'Thinking...'
      : jarvis.hudState === 'speaking'
        ? 'Speaking...'
        : jarvis.hudState === 'error'
          ? (jarvis.errorText ?? 'Voice error')
          : jarvis.wakeArmed
            ? 'Hey Adam - armed'
            : 'Listening...'

  const agentLabel = agentMode
    ? agent.state === 'idle'
      ? 'Tap or press Cmd+T to talk'
      : agent.state === 'connecting'
        ? 'Connecting...'
        : agent.state === 'speaking'
          ? 'Speaking...'
          : agent.state === 'error'
            ? (agent.errorText ?? 'Voice error')
            : 'Listening...'
    : null

  // Why dictation and Jarvis outrank agentActive: ⌘E dictation runs
  // independently of whether a live agent is merely configured, so a
  // dictation session in progress must win the caption/orb-level over the
  // agent's permanent "Tap or press Cmd+T to talk" idle placeholder.
  const label = dictationActive
    ? dictationLabel
    : jarvisActive
      ? jarvisLabel
      : agentActive
        ? (agentLabel ?? 'Listening...')
        : dictationLabel

  // Why a stricter flag for the published label: see agentGenuinelyActive
  // above — the dock's caption should only speak while something is
  // genuinely in progress, not nag the idle placeholder permanently.
  const genuinelyActive = dictationActive || jarvisActive || agentGenuinelyActive
  const { state, activitySource } = resolveVoiceOrbPresentation({
    dictationState,
    jarvisState: jarvis.hudState,
    agentMode,
    agentState: agent.state
  })
  const liveGetLevel =
    activitySource === 'input'
      ? dictationActive
        ? getAudioLevel
        : jarvisActive
          ? jarvis.getAudioLevel
          : agent.getInputLevel
      : activitySource === 'output'
        ? agent.getOutputLevel
        : getAudioLevel

  useEffect(() => {
    voiceOrbLevelSource.current = liveGetLevel
    publishVoiceOrbPresentation({ state, activitySource })
  }, [liveGetLevel, state, activitySource])

  useEffect(
    () => () => {
      voiceOrbLevelSource.current = () => 0
      publishVoiceOrbPresentation({ state: 'idle', activitySource: 'preview' })
      setVoiceOrbLabel(null)
    },
    [setVoiceOrbLabel]
  )

  useEffect(() => {
    setVoiceOrbLabel(genuinelyActive ? label : null)
  }, [genuinelyActive, label, setVoiceOrbLabel])

  return null
}
