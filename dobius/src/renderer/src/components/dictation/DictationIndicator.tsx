import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useJarvisTurn } from '../jarvis/use-jarvis-turn'
import { useJarvisVoiceSettings } from '../jarvis/use-jarvis-voice-settings'
import { useVoiceAgent } from '../jarvis/use-voice-agent'
import { VoiceOrb } from './VoiceOrb'
import { voiceOrbLevelSource } from './voice-orb-live-level'

const ORB_SIZE = 128
const CAPTION_RESERVE_PX = 28
const POSITION_STORAGE_KEY = 'dobius.voice-orb-position'
// Pointer slop below which a press counts as a click rather than a drag.
const CLICK_SLOP_PX = 4

type Position = { x: number; y: number }

type DictationIndicatorProps = {
  /** Current mic level, 0..1, polled by the orb once per frame. */
  getAudioLevel: () => number
  /** True when the floating terminal agent dock already shows the one voice
   *  orb — skips this component's own standalone orb so there's never two. */
  hideOwnOrb?: boolean
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
 * Why one component: ⌘E dictation and ⌘T Jarvis are two features but one
 * on-screen object. Jarvis previously drew its own orb in a separate always-on
 * window, which meant two orbs on screen and — worse — ⌘T did nothing unless
 * that window happened to be open. Mounting useJarvisTurn here keeps the
 * shortcut alive for as long as the app is running.
 */
export function DictationIndicator({ getAudioLevel, hideOwnOrb }: DictationIndicatorProps) {
  const dictationState = useAppStore((s) => s.dictationState)
  const partialTranscript = useAppStore((s) => s.partialTranscript)
  const setVoiceOrbLabel = useAppStore((s) => s.setVoiceOrbLabel)
  const jarvis = useJarvisTurn()
  const agent = useVoiceAgent()
  const { flags } = useJarvisVoiceSettings()
  const agentMode = flags.jarvisEnabled && flags.agentId !== ''

  // ⌘T reaches this window as a Jarvis press event; in live mode it opens or
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
    const onResize = (): void =>
      setPosition((current) => (current ? clampToViewport(current) : null))
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
  // until a conversation exists left no way in if ⌘T never arrived, and no clue
  // that anything was wrong.
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

  // Why visible while idle: in live mode the orb IS the start button.
  const isActive = agentActive || jarvisActive || dictationActive
  // Why a stricter flag for the published label: see agentGenuinelyActive
  // above — the dock's caption should only speak while something is
  // genuinely in progress, not nag the idle placeholder permanently.
  const genuinelyActive = dictationActive || jarvisActive || agentGenuinelyActive
  const liveGetLevel = dictationActive
    ? getAudioLevel
    : jarvisActive
      ? jarvis.getAudioLevel
      : agentActive
        ? agent.getAudioLevel
        : getAudioLevel

  // Why plain assignment, not state: VoiceOrb polls this every animation
  // frame, not through React re-renders — mirrors VoiceOrb's own
  // `getLevelRef.current = getLevel` pattern. Runs every render regardless
  // of hideOwnOrb so the dock's orb animates even when this one is hidden.
  voiceOrbLevelSource.current = liveGetLevel

  useEffect(() => {
    setVoiceOrbLabel(genuinelyActive ? label : null)
  }, [genuinelyActive, label, setVoiceOrbLabel])

  if (hideOwnOrb || !isActive) {
    return null
  }

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
      <VoiceOrb size={ORB_SIZE} getLevel={liveGetLevel} />
      <span className="max-w-md truncate rounded-md bg-foreground/90 px-2.5 py-1 text-xs text-background shadow-lg">
        {label}
      </span>
    </div>
  )
}
