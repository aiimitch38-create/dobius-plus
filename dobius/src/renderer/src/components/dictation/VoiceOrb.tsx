import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { OrbCharacter, SAVED_PRESETS } from 'orb-character'
import 'orb-character/style.css'

import { getVoiceOrbPresentation, subscribeVoiceOrbPresentation } from './voice-orb-live-level'
import type { VoiceOrbActivitySource } from './voice-orb-state'

type VoiceOrbProps = {
  /** Pixel size of the square orb. */
  size: number
  /** Returns the current input or output level, normalized to 0..1. */
  getLevel: () => number
  className?: string
}

function clampActivity(level: number): number {
  return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
}

export function useOrbActivity(
  getLevel: () => number,
  activitySource: VoiceOrbActivitySource
): number | undefined {
  const active = activitySource !== 'preview'
  const [activity, setActivity] = useState(0)
  const getLevelRef = useRef(getLevel)
  getLevelRef.current = getLevel
  useEffect(() => {
    if (!active) {
      return
    }
    let frame = 0
    const refresh = (): void => {
      const next = clampActivity(getLevelRef.current())
      setActivity((current) => (next === 0 || Math.abs(current - next) >= 0.01 ? next : current))
      frame = requestAnimationFrame(refresh)
    }
    refresh()
    return () => cancelAnimationFrame(frame)
  }, [active, activitySource])

  if (!active) {
    return undefined
  }
  return activity
}

export function VoiceOrb({ size, getLevel, className }: VoiceOrbProps) {
  const { state, activitySource } = useSyncExternalStore(
    subscribeVoiceOrbPresentation,
    getVoiceOrbPresentation
  )
  const activity = useOrbActivity(getLevel, activitySource)

  return (
    <OrbCharacter
      aria-hidden="true"
      className={className}
      form="face"
      state={state}
      activity={activity}
      presets={SAVED_PRESETS}
      size={size}
      background="transparent"
      quality={size <= 48 ? 'preview' : 'full'}
    />
  )
}
