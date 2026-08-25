import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useAppStore } from '@/store'
import { VoiceOrb } from './VoiceOrb'
import type { JarvisStateEvent } from '../../../../shared/speech-types'

const ORB_SIZE = 128
const ORB_OFFSET_STORAGE_KEY = 'dobius.orb-offset.v1'

type DictationIndicatorProps = {
  /** Current mic level, 0..1, polled by the orb once per frame. */
  getAudioLevel: () => number
}

type OrbOffset = { x: number; y: number }

function loadOffset(): OrbOffset {
  try {
    const raw = window.localStorage.getItem(ORB_OFFSET_STORAGE_KEY)
    if (!raw) return { x: 0, y: 0 }
    const parsed = JSON.parse(raw) as Partial<OrbOffset>
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y }
    }
  } catch {
    // Corrupt offset falls back to the default spot.
  }
  return { x: 0, y: 0 }
}

/**
 * THE single voice orb. Renders for ordinary ⌘E dictation AND for Jarvis
 * turns (⌘T / "Hey Adam"): listening comes from the live dictation session,
 * thinking/speaking/error from main's jarvis:state broadcasts. Drag the orb
 * anywhere; the offset persists per app install.
 */
export function DictationIndicator({ getAudioLevel }: DictationIndicatorProps) {
  const dictationState = useAppStore((s) => s.dictationState)
  const partialTranscript = useAppStore((s) => s.partialTranscript)
  const [jarvisState, setJarvisState] = useState<JarvisStateEvent['state']>('idle')
  const [jarvisReason, setJarvisReason] = useState<string | undefined>(undefined)
  const [offset, setOffset] = useState<OrbOffset>(loadOffset)
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  useEffect(
    () =>
      window.api.jarvis?.onState((event) => {
        setJarvisState(event.state)
        setJarvisReason(event.reason)
      }) ?? undefined,
    []
  )

  const dictationActive =
    dictationState === 'listening' ||
    dictationState === 'starting' ||
    dictationState === 'stopping'
  const jarvisActive = jarvisState === 'thinking' || jarvisState === 'speaking' || jarvisState === 'error'
  if (!dictationActive && !jarvisActive) {
    return null
  }

  const label = dictationActive
    ? dictationState === 'starting'
      ? 'Starting...'
      : dictationState === 'stopping'
        ? 'Processing...'
        : partialTranscript || 'Listening...'
    : jarvisState === 'thinking'
      ? 'Thinking...'
      : jarvisState === 'speaking'
        ? 'Speaking...'
        : jarvisReason || 'ADAM unreachable'

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startY: event.clientY, baseX: offset.x, baseY: offset.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    setOffset({ x: drag.baseX + (event.clientX - drag.startX), y: drag.baseY + (event.clientY - drag.startY) })
  }
  const onPointerUp = (): void => {
    if (!dragRef.current) return
    dragRef.current = null
    setOffset((current) => {
      window.localStorage.setItem(ORB_OFFSET_STORAGE_KEY, JSON.stringify(current))
      return current
    })
  }

  return (
    <div
      className="pointer-events-none fixed bottom-12 left-1/2 z-50 flex flex-col items-center gap-2"
      style={{ transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)` }}
      role="status"
      aria-live="polite"
    >
      <div
        className="pointer-events-auto cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <VoiceOrb size={ORB_SIZE} getLevel={getAudioLevel} />
      </div>
      <span className="max-w-md truncate rounded-md bg-foreground/90 px-2.5 py-1 text-xs text-background shadow-lg">
        {label}
      </span>
    </div>
  )
}
