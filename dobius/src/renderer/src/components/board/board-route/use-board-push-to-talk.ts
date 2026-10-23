import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { dispatchDictationControl } from '@/components/dictation/dictation-control-events'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isBoardShortcutBlockedTarget } from '../board-chrome/board-tools'

// Why: a short hold before the mic opens lets Space+drag pan without ever
// starting a dictation session.
const HOLD_BEFORE_LISTEN_MS = 250

type Session = { timer: ReturnType<typeof setTimeout> | null; started: boolean }

export type BoardPushToTalk = { spaceHeld: boolean; cancelForPan: () => void }

/**
 * Hold Space → focus the command input and drive the EXISTING dictation
 * controller (it inserts the transcript into the focused input); release →
 * stop, then `onTranscriptReady` once the controller returns to idle.
 */
export function useBoardPushToTalk(
  inputRef: React.RefObject<HTMLInputElement | null>,
  onTranscriptReady: () => void
): BoardPushToTalk {
  const [spaceHeld, setSpaceHeld] = useState(false)
  const session = useRef<Session | null>(null)
  // Set while a stop is in flight; discard = the transcript must not be submitted.
  const awaitingIdle = useRef<{ discard: boolean } | null>(null)
  const readyRef = useRef(onTranscriptReady)
  readyRef.current = onTranscriptReady

  const stop = useCallback((discard: boolean) => {
    const current = session.current
    if (!current) {
      return
    }
    if (current.timer) {
      clearTimeout(current.timer)
      current.timer = null
    }
    session.current = null
    setSpaceHeld(false)
    if (!current.started) {
      return
    }
    if (useAppStore.getState().dictationState === 'idle') {
      // The controller ignored 'start' (voice off or no model configured).
      if (!discard) {
        toast.message(
          translate('board.voice.off', 'Turn on voice dictation in Settings to talk to the Board.')
        )
      }
      return
    }
    awaitingIdle.current = { discard }
    dispatchDictationControl('stop')
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') {
        return
      }
      if (session.current) {
        // Swallow auto-repeat so held Space never types into the focused input.
        event.preventDefault()
        return
      }
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isBoardShortcutBlockedTarget(event.target) ||
        // Space on a focused button or link presses it; it is not push-to-talk.
        (event.target instanceof Element && event.target.closest('button, [role="button"], a'))
      ) {
        return
      }
      event.preventDefault()
      setSpaceHeld(true)
      const next: Session = { timer: null, started: false }
      next.timer = setTimeout(() => {
        next.timer = null
        next.started = true
        inputRef.current?.focus()
        dispatchDictationControl('start')
      }, HOLD_BEFORE_LISTEN_MS)
      session.current = next
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') {
        stop(false)
      }
    }
    const onBlur = (): void => stop(true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      stop(true)
    }
  }, [inputRef, stop])

  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        if (!awaitingIdle.current || state.dictationState === prev.dictationState) {
          return
        }
        if (state.dictationState !== 'idle' && state.dictationState !== 'error') {
          return
        }
        const { discard } = awaitingIdle.current
        awaitingIdle.current = null
        if (!discard && state.dictationState === 'idle') {
          readyRef.current()
        }
      }),
    []
  )

  // Panning keeps Space "held" until keyup; it only cancels the mic.
  const cancelForPan = useCallback(() => {
    const current = session.current
    if (!current) {
      return
    }
    if (current.timer) {
      clearTimeout(current.timer)
      current.timer = null
    }
    if (current.started) {
      current.started = false
      if (useAppStore.getState().dictationState !== 'idle') {
        awaitingIdle.current = { discard: true }
        dispatchDictationControl('stop')
      }
    }
  }, [])
  return { spaceHeld, cancelForPan }
}
