import { useEffect } from 'react'
import { useJarvisTurn } from './use-jarvis-turn'
import type { OrbHudState } from './use-jarvis-turn'
import './orb-view.css'

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
  const { hudState, wakeArmed, ambientActive, toggleTurn } = useJarvisTurn()

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
        <span className="jarvis-orb-ring" />
        <span className="jarvis-orb-core" />
      </button>
      {caption ? <span className="jarvis-orb-caption">{caption}</span> : null}
    </div>
  )
}
