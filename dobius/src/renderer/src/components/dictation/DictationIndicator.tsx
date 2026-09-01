import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useJarvisTurn } from '../jarvis/use-jarvis-turn'
import { useJarvisVoiceSettings } from '../jarvis/use-jarvis-voice-settings'
import { useVoiceAgent } from '../jarvis/use-voice-agent'
import { VoiceOrb } from './VoiceOrb'

const ORB_SIZE = 128
const CAPTION_RESERVE_PX = 28
const POSITION_STORAGE_KEY = 'dobius.voice-orb-position'
// Pointer slop below which a press counts as a click rather than a drag.
const CLICK_SLOP_PX = 4

type Position = { x: number; y: number }

type DictationIndicatorProps = {
  /** Current mic level, 0..1, polled by the orb once per frame. */
  getAudioLevel: () => number
}

function clampToViewport(position: Position): Position {
  const maxX = Math.max(0, window.innerWidth - ORB_SIZE)
  const maxY = Math.max(0, window.innerHeight - ORB_SIZE - CAPTION_RESERVE_PX)
  return {
    x: Math.min(Math.max(position.x, 0), maxX),
    y: Math.min(Math.max(position.y, 0), maxY)
  }
}

function readSavedPosition(): Position | null {
  try {
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<Position>
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
      return null
    }
    return clampToViewport({ x: parsed.x, y: parsed.y })
  } catch {
    // A corrupt entry must not stop the orb from rendering at its default spot.
    return null
  }
}

/**
 * The single voice orb for the whole product.
 *
 * Why one component: ⌘E dictation and ⌥Space Jarvis are two features but one
 * on-screen object. Jarvis previously drew its own orb in a separate always-on
 * window, which meant two orbs on screen and — worse — ⌥Space did nothing unless
 * that window happened to be open. Mounting useJarvisTurn here keeps the
 * shortcut alive for as long as the app is running.
 */
export function DictationIndicator({ getAudioLevel }: DictationIndicatorProps) {
  const dictationState = useAppStore((s) => s.dictationState)
  const partialTranscript = useAppStore((s) => s.partialTranscript)
  const jarvis = useJarvisTurn()
  const agent = useVoiceAgent()
  const { flags } = useJarvisVoiceSettings()
  const agentMode = flags.jarvisEnabled && flags.agentId !== ''

  // ⌥Space reaches this window as a Jarvis press event; in live mode it opens or
  // closes the conversation instead of starting a single turn.
  useEffect(() => {
    if (!agentMode) {
      return
    }
    return window.api.jarvis.onPttPressed(() => agent.toggle())
  }, [agent, agentMode])

  const [position, setPosition] = useState<Position | null>(readSavedPosition)
  const dragRef = useRef<{ pointerId: number; dx: number; dy: number; moved: boolean } | null>(null)

  useEffect(() => {
    const onResize = (): void => setPosition((current) => (current ? clampToViewport(current) : null))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      moved: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    if (!drag.moved && Math.abs(event.movementX) + Math.abs(event.movementY) < CLICK_SLOP_PX) {
      // Ignore pointer jitter so a plain click is never read as a tiny drag.
      return
    }
    drag.moved = true
    setPosition(clampToViewport({ x: event.clientX - drag.dx, y: event.clientY - drag.dy }))
  }, [])

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag || drag.pointerId !== event.pointerId) {
        return
      }
      event.currentTarget.releasePointerCapture(event.pointerId)
      if (drag.moved) {
        setPosition((current) => {
          if (current) {
            window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(current))
          }
          return current
        })
        return
      }
      if (agentMode) {
        agent.toggle()
        return
      }
      jarvis.toggleTurn()
    },
    [agent, agentMode, jarvis]
  )

  // Why visible while idle: in live mode the orb IS the start button. Hiding it
  // until a conversation exists left no way in if ⌥Space never arrived, and no clue
  // that anything was wrong.
  const agentActive = agentMode
  const jarvisActive = !agentMode && jarvis.hudState !== 'idle'
  const dictationActive =
    dictationState === 'listening' || dictationState === 'starting' || dictationState === 'stopping'

  if (!agentActive && !jarvisActive && !dictationActive) {
    return null
  }

  const agentLabel = agentMode
    ? agent.state === 'idle'
      ? 'Tap or press Option+Space to talk'
      : agent.state === 'connecting'
      ? 'Connecting...'
      : agent.state === 'speaking'
        ? 'Speaking...'
        : agent.state === 'error'
          ? (agent.errorText ?? 'Voice error')
          : 'Listening...'
    : null

  const label = agentActive
    ? (agentLabel ?? 'Listening...')
    : jarvisActive
    ? jarvis.hudState === 'thinking'
      ? 'Thinking...'
      : jarvis.hudState === 'speaking'
        ? 'Speaking...'
        : jarvis.hudState === 'error'
          ? (jarvis.errorText ?? 'Voice error')
          : jarvis.wakeArmed
            ? 'Hey Adam - armed'
            : 'Listening...'
    : dictationState === 'starting'
      ? 'Starting...'
      : dictationState === 'stopping'
        ? 'Processing...'
        : partialTranscript || 'Listening...'

  const positionStyle: React.CSSProperties = position
    ? { left: position.x, top: position.y }
    : { bottom: 48, left: '50%', transform: 'translateX(-50%)' }

  return (
    <div
      className="fixed z-50 flex cursor-grab flex-col items-center gap-2 active:cursor-grabbing"
      style={positionStyle}
      role="status"
      aria-live="polite"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="Drag to move - click to talk to ADAM"
    >
      <VoiceOrb
        size={ORB_SIZE}
        getLevel={
          agentActive ? agent.getAudioLevel : jarvisActive ? jarvis.getAudioLevel : getAudioLevel
        }
      />
      <span className="max-w-md truncate rounded-md bg-foreground/90 px-2.5 py-1 text-xs text-background shadow-lg">
        {label}
      </span>
    </div>
  )
}
