import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useAppStore } from '@/store'
import { VoiceOrb } from './VoiceOrb'
import { requestJarvisToggle } from '../jarvis/jarvis-toggle-registry'

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

/** A press that moves less than this and releases fast is a click, not a drag. */
const CLICK_SLOP_PX = 5
const CLICK_MAX_MS = 400

/**
 * THE single voice orb. Renders for ordinary ⌘E dictation AND for Jarvis
 * turns (⌘T / "Hey Adam"); stays pinned while Jarvis talk mode is enabled so
 * there is always something to look at and click. Jarvis phases come from the
 * store mirror the voice controller writes — including manual ⌘T listening,
 * which main never broadcasts. Drag anywhere; offset persists per install.
 */
export function DictationIndicator({ getAudioLevel }: DictationIndicatorProps) {
  const dictationState = useAppStore((s) => s.dictationState)
  const partialTranscript = useAppStore((s) => s.partialTranscript)
  const jarvisHud = useAppStore((s) => s.jarvisHud)
  const jarvisEnabled = useAppStore((s) => s.settings?.voice?.jarvisEnabled === true)
  const [offset, setOffset] = useState<OrbOffset>(loadOffset)
  const gestureRef = useRef<{
    startX: number
    startY: number
    baseX: number
    baseY: number
    moved: boolean
    startedAt: number
  } | null>(null)

  const dictationActive =
    dictationState === 'listening' ||
    dictationState === 'starting' ||
    dictationState === 'stopping'
  const jarvisActive = jarvisHud.state !== 'idle'
  if (!dictationActive && !jarvisActive && !jarvisEnabled) {
    return null
  }

  const label = dictationActive
    ? dictationState === 'starting'
      ? 'Starting...'
      : dictationState === 'stopping'
        ? 'Processing...'
        : partialTranscript || 'Listening...'
    : jarvisHud.state === 'thinking'
      ? 'Thinking...'
      : jarvisHud.state === 'speaking'
        ? 'Speaking...'
        : jarvisHud.state === 'listening'
          ? 'Listening...'
          : jarvisHud.state === 'error'
            ? (jarvisHud.reason ?? 'ADAM unreachable')
            : 'Hey Adam'

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    gestureRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
      moved: false,
      startedAt: Date.now()
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current
    if (!gesture) return
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    if (!gesture.moved && Math.hypot(dx, dy) > CLICK_SLOP_PX) {
      gesture.moved = true
    }
    setOffset({ x: gesture.baseX + dx, y: gesture.baseY + dy })
  }
  const onPointerUp = (): void => {
    const gesture = gestureRef.current
    if (!gesture) return
    gestureRef.current = null
    if (!gesture.moved && Date.now() - gesture.startedAt < CLICK_MAX_MS) {
      requestJarvisToggle()
      setOffset({ x: gesture.baseX, y: gesture.baseY })
      return
    }
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
        <VoiceOrb size={ORB_SIZE} getLevel={getAudioLevel} error={jarvisHud.state === 'error'} />
      </div>
      {label ? (
        <span className="max-w-md truncate rounded-md bg-foreground/90 px-2.5 py-1 text-xs text-background shadow-lg">
          {label}
        </span>
      ) : null}
    </div>
  )
}
