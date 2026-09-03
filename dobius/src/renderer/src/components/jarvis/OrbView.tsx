import { useEffect } from 'react'
import { VoiceOrb } from '../dictation/VoiceOrb'
import { useJarvisTurn } from './use-jarvis-turn'
import type { OrbHudState } from './use-jarvis-turn'
import './orb-view.css'

// ponytail: one orb in the product. This window shows the SAME VoiceOrb the
// dictation HUD draws, so Jarvis never introduces a second look.
const ORB_SIZE = 128

function orbStateClasses(hudState: OrbHudState, ambientActive: boolean, wakeArmed: boolean): string {
  const classes = ['jarvis-orb']
  if (wakeArmed) {
    classes.push('jarvis-orb-armed')
  }
  if (hudState !== 'idle') {
    classes.push(`jarvis-orb-${hudState}`)
  } else if (ambientActive) {
    classes.push('jarvis-orb-ambient')
  } else {
    classes.push('jarvis-orb-idle')
  }
  return classes.join(' ')
}

export function OrbView(): React.JSX.Element {
  const { hudState, wakeArmed, ambientActive, toggleTurn, errorText, getAudioLevel } =
    useJarvisTurn()

  // Why documentElement: transparency must apply before React paints; a class
  // on the root div cannot restyle <body> (mirrors FloatingPhoneRoot).
  useEffect(() => {
    document.documentElement.classList.add('jarvis-orb-document')
    return () => document.documentElement.classList.remove('jarvis-orb-document')
  }, [])

  const caption = wakeArmed
    ? 'Hey Adam — armed'
    : hudState === 'listening'
      ? 'Listening'
      : hudState === 'thinking'
        ? 'Thinking'
        : hudState === 'speaking'
          ? 'Speaking'
          : hudState === 'error'
            ? (errorText ?? 'Voice error')
            : null

  return (
    <div className="jarvis-orb-root">
      <button
        type="button"
        className={`jarvis-orb-button ${orbStateClasses(hudState, ambientActive, wakeArmed)}`}
        onClick={toggleTurn}
        aria-label="Jarvis voice orb"
        title={caption ?? 'Click to talk to ADAM'}
      >
        <VoiceOrb size={ORB_SIZE} getLevel={getAudioLevel} />
      </button>
      {caption ? <span className="jarvis-orb-caption">{caption}</span> : null}
    </div>
  )
}
