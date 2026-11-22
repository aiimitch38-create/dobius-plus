import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useAdamVoiceThread } from '../board/board-route/adam-voice-thread'
import { useJarvisTurn } from '../jarvis/use-jarvis-turn'
import { useJarvisVoiceSettings } from '../jarvis/use-jarvis-voice-settings'
import { useVoiceAgent } from '../jarvis/use-voice-agent'
import { useLiveVoice, type LiveVoice } from '../jarvis/use-live-voice'
import { voiceOrbLevelSource, publishVoiceOrbPresentation } from './voice-orb-live-level'
import { resolveVoiceOrbPresentation } from './voice-orb-state'

/** What the orb says during an OpenAI Live call, for the states only it has. */
function liveCallLabel(live: Pick<LiveVoice, 'state' | 'muted'>): string {
  if (live.state === 'thinking') {
    return 'ADAM is working on it...'
  }
  if (live.muted) {
    return 'Muted - press Cmd+T to talk'
  }
  return live.state === 'standby' ? 'Standby - just start talking' : 'Listening...'
}

type DictationIndicatorProps = {
  /** Current mic level, 0..1, polled by the orb once per frame. */
  getAudioLevel: () => number
}

/**
 * Coordinates dictation, Jarvis, and live-agent voice state for the shared character.
 * Home and the composer consume this state without opening another microphone.
 */
export function DictationIndicator({ getAudioLevel }: DictationIndicatorProps) {
  const dictationState = useAppStore((s) => s.dictationState)
  const partialTranscript = useAppStore((s) => s.partialTranscript)
  const setVoiceOrbLabel = useAppStore((s) => s.setVoiceOrbLabel)
  const jarvis = useJarvisTurn()
  useAdamVoiceThread()
  const agent = useVoiceAgent()
  const toggleAgent = agent.toggle
  const { flags } = useJarvisVoiceSettings()
  const live = useLiveVoice(flags.liveVoice.micMode)
  const pressLive = live.press
  const hangUpLive = live.hangUp
  // The engine chosen in Settings > Voice, after its fallbacks (no key, no
  // ElevenLabs agent id): OpenAI Live calls, the ElevenLabs conversation, or
  // Hermes turns (useJarvisTurn) when neither runs.
  const liveMode = flags.jarvisEnabled && flags.activeVoiceEngine === 'openai-live'
  const elevenLabsMode = flags.jarvisEnabled && flags.activeVoiceEngine === 'elevenlabs'
  const agentMode = liveMode || elevenLabsMode

  // ⌘T reaches this window as a Jarvis press event; in a live engine it opens,
  // mutes or closes the call instead of starting a single turn.
  useEffect(() => {
    if (!elevenLabsMode) {
      return
    }
    return window.api.jarvis.onPttPressed(toggleAgent)
  }, [toggleAgent, elevenLabsMode])

  useEffect(() => {
    if (!liveMode) {
      // Why: switching engines (or turning voice off) must not leave a paid call open.
      hangUpLive()
      return
    }
    return window.api.jarvis.onPttPressed(pressLive)
  }, [pressLive, hangUpLive, liveMode])

  const agentState = liveMode ? live.state : agent.state
  const agentErrorText = liveMode ? live.errorText : agent.errorText

  // Why a toast: the orb caption shows only on the floating dock orb, so a
  // failed call started from the Board orb otherwise fails silently.
  useEffect(() => {
    if (agentMode && agentState === 'error' && agentErrorText) {
      toast.error(agentErrorText)
    }
  }, [agentMode, agentState, agentErrorText])

  const agentActive = agentMode
  const jarvisActive = !agentMode && jarvis.hudState !== 'idle'
  const dictationActive =
    dictationState === 'listening' || dictationState === 'starting' || dictationState === 'stopping'
  // Why separate from agentActive: agentActive is true the instant a live
  // agent is merely *configured*, at rest, forever. This is true only while
  // an actual agent turn is in progress.
  const agentGenuinelyActive = agentActive && agentState !== 'idle'

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
    ? agentState === 'idle'
      ? 'Tap or press Cmd+T to talk'
      : agentState === 'connecting'
        ? 'Connecting...'
        : agentState === 'speaking'
          ? 'Speaking...'
          : agentState === 'error'
            ? (agentErrorText ?? 'Voice error')
            : liveMode
              ? liveCallLabel(live)
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
    agentState
  })
  const liveGetLevel =
    activitySource === 'input'
      ? dictationActive
        ? getAudioLevel
        : jarvisActive
          ? jarvis.getAudioLevel
          : liveMode
            ? live.getInputLevel
            : agent.getInputLevel
      : activitySource === 'output'
        ? liveMode
          ? live.getOutputLevel
          : agent.getOutputLevel
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
