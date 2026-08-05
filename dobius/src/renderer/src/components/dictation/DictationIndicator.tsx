import { useAppStore } from '@/store'
import { VoiceOrb } from './VoiceOrb'

const ORB_SIZE = 128

type DictationIndicatorProps = {
  /** Current mic level, 0..1, polled by the orb once per frame. */
  getAudioLevel: () => number
}

export function DictationIndicator({ getAudioLevel }: DictationIndicatorProps) {
  const dictationState = useAppStore((s) => s.dictationState)
  const partialTranscript = useAppStore((s) => s.partialTranscript)

  if (
    dictationState !== 'listening' &&
    dictationState !== 'starting' &&
    dictationState !== 'stopping'
  ) {
    return null
  }

  const label =
    dictationState === 'starting'
      ? 'Starting...'
      : dictationState === 'stopping'
        ? 'Processing...'
        : partialTranscript || 'Listening...'

  return (
    <div
      className="pointer-events-none fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      <VoiceOrb size={ORB_SIZE} getLevel={getAudioLevel} />
      <span className="max-w-md truncate rounded-md bg-foreground/90 px-2.5 py-1 text-xs text-background shadow-lg">
        {label}
      </span>
    </div>
  )
}
