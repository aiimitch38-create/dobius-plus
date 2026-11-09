import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { OrbCharacter, SAVED_PRESETS } from 'orb-character'
import 'orb-character/style.css'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { useAppStore } from '../../store'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../shared/agent-status-types'
import { selectPetAnimationName } from '../pet/pet-agent-state'
import {
  getVoiceOrbPresentation,
  subscribeVoiceOrbPresentation,
  voiceOrbLevelSource
} from '../dictation/voice-orb-live-level'
import { useOrbActivity } from '../dictation/VoiceOrb'
import { resolveAdamCharacterState } from './adam-animation-state'
import { ADAM_SETTLE_POSITION, clampAdamPosition, pickAdamWanderTarget, type Position } from './adam-wander'

const ADAM_SIZE = 132
const POSITION_STORAGE_KEY = 'adam-presence-position'
const WANDER_MIN_MS = 9000
const WANDER_MAX_MS = 17000
// Drag vs. click-to-dock: a pointer that moved less than this many px between
// down and up was a click, not a drag.
const CLICK_DRAG_THRESHOLD = 4

function readSharedOrbLevel(): number {
  return voiceOrbLevelSource.current()
}

function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 }
  }
  return { width: window.innerWidth, height: window.innerHeight }
}

function loadStoredAdamPosition(): Position | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<Position>
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
      return null
    }
    return clampAdamPosition({ x: parsed.x, y: parsed.y }, ADAM_SIZE, viewportSize())
  } catch {
    return null
  }
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  )
  useEffect(() => {
    const onChange = (): void => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

// Why: mirrors PetOverlay's usePetAnimationName — same live agent-status feed,
// so Adam's idle fallback expression and the pet overlay agree on "busy" vs
// "waiting" vs "done" without a second source of truth.
function useAdamAgentAnimation(dragging: boolean): ReturnType<typeof selectPetAnimationName> {
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const agentStatusEpoch = useAppStore((s) => s.agentStatusEpoch)
  const retainedAgentsByPaneKey = useAppStore((s) => s.retainedAgentsByPaneKey)
  void agentStatusEpoch
  return selectPetAnimationName({
    entries: Object.values(agentStatusByPaneKey),
    retainedCount: Object.keys(retainedAgentsByPaneKey).length,
    dragging,
    now: Date.now(),
    staleAfterMs: AGENT_STATUS_STALE_AFTER_MS
  })
}

/**
 * Adam's roaming presence. Dormant (not mounted visually) until the user
 * wakes him by clicking the docked orb in the floating-terminal toggle,
 * which flips `adamAwake` in the store. Once awake he plays a grow+rise
 * entrance, settles near the top-left, and idly wanders nearby — driven by
 * the same live voice state and agent-status feed as the docked orb and the
 * pet overlay, so there's exactly one source of truth for "what Adam is
 * doing" no matter where he's rendered.
 */
export function AdamPresence(): React.JSX.Element | null {
  const persistedUIReady = useAppStore((s) => s.persistedUIReady)
  const awake = useAppStore((s) => s.adamAwake)
  const setAwake = useAppStore((s) => s.setAdamAwake)
  const wakeOrigin = useAppStore((s) => s.adamWakeOrigin)
  const setWakeOrigin = useAppStore((s) => s.setAdamWakeOrigin)
  const dockRequestId = useAppStore((s) => s.adamDockRequestId)
  const documentVisible = useDocumentVisible()
  const reducedMotion = usePrefersReducedMotion()

  const { state: voiceState, activitySource } = useSyncExternalStore(
    subscribeVoiceOrbPresentation,
    getVoiceOrbPresentation
  )
  const activity = useOrbActivity(readSharedOrbLevel, activitySource)

  const [dragging, setDragging] = useState(false)
  const dragOffsetRef = useRef<Position>({ x: 0, y: 0 })
  const dragDistanceRef = useRef(0)
  const [position, setPosition] = useState<Position>(
    () => loadStoredAdamPosition() ?? clampAdamPosition(ADAM_SETTLE_POSITION, ADAM_SIZE, viewportSize())
  )
  // 'start' is the pre-paint frame of a wake entrance (small, low, transparent);
  // the very next frame flips to 'end' so the browser animates between them.
  // 'exit' plays the reverse — shrinking back toward the dock — before the
  // component actually unmounts.
  const [entryPhase, setEntryPhase] = useState<'start' | 'end' | 'exit'>('end')
  const wanderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const agentAnimation = useAdamAgentAnimation(dragging)
  const characterState = resolveAdamCharacterState({ state: voiceState, activitySource }, agentAnimation)

  // Wake: start exactly where the dock orb was clicked (so he visibly emerges
  // from it, not just fades in elsewhere), then glide to the settle spot.
  // The origin is a one-shot cue — consumed and cleared here so a later
  // wake with no recorded click falls back to the settle spot directly.
  useEffect(() => {
    if (!awake) {
      return
    }
    const origin = wakeOrigin
    const settle = clampAdamPosition(ADAM_SETTLE_POSITION, ADAM_SIZE, viewportSize())
    if (origin) {
      setPosition(clampAdamPosition({ x: origin.x - ADAM_SIZE / 2, y: origin.y - ADAM_SIZE / 2 }, ADAM_SIZE, viewportSize()))
      setWakeOrigin(null)
    } else {
      setPosition(settle)
    }
    setEntryPhase('start')
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setEntryPhase('end')
        setPosition(settle)
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) {
        cancelAnimationFrame(raf2)
      }
    }
    // wakeOrigin/setWakeOrigin intentionally excluded: this must run only on
    // the awake transition, not every time the origin store value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awake])

  // Idle wander: only once awake, settled, not being dragged, and motion is
  // welcome (respects reduced-motion and a backgrounded window).
  useEffect(() => {
    if (!awake || dragging || reducedMotion || !documentVisible || entryPhase !== 'end') {
      return
    }
    let cancelled = false
    const scheduleNext = (): void => {
      const delay = WANDER_MIN_MS + Math.random() * (WANDER_MAX_MS - WANDER_MIN_MS)
      wanderTimerRef.current = setTimeout(() => {
        if (cancelled) {
          return
        }
        setPosition(pickAdamWanderTarget(ADAM_SIZE, viewportSize()))
        scheduleNext()
      }, delay)
    }
    scheduleNext()
    return () => {
      cancelled = true
      if (wanderTimerRef.current) {
        clearTimeout(wanderTimerRef.current)
      }
    }
  }, [awake, dragging, reducedMotion, documentVisible, entryPhase])

  useEffect(() => {
    if (!awake) {
      return
    }
    const onResize = (): void => setPosition((prev) => clampAdamPosition(prev, ADAM_SIZE, viewportSize()))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [awake])

  useEffect(() => {
    if (dragging || !awake) {
      return
    }
    try {
      window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(position))
    } catch {
      // ignore storage failures
    }
  }, [dragging, position, awake])

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) {
        return
      }
      dragOffsetRef.current = { x: event.clientX - position.x, y: event.clientY - position.y }
      dragDistanceRef.current = 0
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
      event.preventDefault()
    },
    [position]
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragging) {
        return
      }
      const next = clampAdamPosition(
        { x: event.clientX - dragOffsetRef.current.x, y: event.clientY - dragOffsetRef.current.y },
        ADAM_SIZE,
        viewportSize()
      )
      dragDistanceRef.current += Math.abs(event.movementX) + Math.abs(event.movementY)
      setPosition(next)
    },
    [dragging]
  )

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
  }, [])

  // Docking: fly back toward the real dock slot (tracked live via
  // adamDockAnchor, since the dock itself is draggable), play the reverse of
  // the wake entrance, then go dormant. Reads the store directly rather than
  // a closed-over selector value so a dock request fired from the dock
  // button itself always targets the dock's current position.
  const dock = useCallback((): void => {
    const anchor = useAppStore.getState().adamDockAnchor ?? ADAM_SETTLE_POSITION
    setEntryPhase('exit')
    setPosition(
      clampAdamPosition(
        { x: anchor.x - ADAM_SIZE / 2, y: anchor.y - ADAM_SIZE / 2 },
        ADAM_SIZE,
        viewportSize()
      )
    )
    window.setTimeout(() => {
      setAwake(false)
      setEntryPhase('end')
    }, 480)
  }, [setAwake])

  // The dock button can request Adam return without the user clicking Adam
  // directly — e.g. clicking the now-empty dock slot while he's roaming.
  const dockRequestSeenRef = useRef(dockRequestId)
  useEffect(() => {
    if (dockRequestId === dockRequestSeenRef.current) {
      return
    }
    dockRequestSeenRef.current = dockRequestId
    if (awake) {
      dock()
    }
  }, [dockRequestId, awake, dock])

  // A click (not a drag) docks Adam back into the floating-terminal orb.
  const onClick = useCallback((): void => {
    if (dragDistanceRef.current > CLICK_DRAG_THRESHOLD) {
      return
    }
    dock()
  }, [dock])

  if (!persistedUIReady || !awake) {
    return null
  }

  const animate = documentVisible && !reducedMotion && !dragging
  const settled = entryPhase === 'end'
  const moving = !settled || dragging

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Adam"
      className="fixed z-50 select-none"
      style={{
        left: position.x,
        top: position.y,
        width: ADAM_SIZE,
        height: ADAM_SIZE,
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        transform: settled ? 'scale(1) translateY(0)' : 'scale(0.32) translateY(44px)',
        opacity: settled ? 1 : 0,
        transition:
          reducedMotion || dragging
            ? 'none'
            : entryPhase === 'exit'
              ? 'transform 440ms cubic-bezier(.4,0,1,1), opacity 420ms ease-in, left 440ms cubic-bezier(.4,0,1,1), top 440ms cubic-bezier(.4,0,1,1)'
              : 'transform 520ms cubic-bezier(.22,1,.36,1), opacity 360ms ease-out, left 2200ms ease-in-out, top 2200ms ease-in-out'
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          dock()
        }
      }}
    >
      <OrbCharacter
        aria-hidden="true"
        form="face"
        state={characterState}
        activity={activity}
        presets={SAVED_PRESETS}
        size={ADAM_SIZE}
        background="transparent"
        quality={moving ? 'preview' : 'full'}
        paused={!animate}
      />
    </div>
  )
}

export default AdamPresence
