import { useCallback, useEffect, useRef, useState, type RefObject, type SetStateAction } from 'react'
import { useAppStore } from '@/store'
import { TOGGLE_FLOATING_TERMINAL_EVENT } from '@/lib/floating-terminal'
import {
  createFloatingWorkspaceTourInteractionSnapshot,
  type FloatingWorkspaceTourInteractionSnapshot
} from '@/lib/floating-workspace-tour-interaction-snapshot'

export type UseFloatingTerminalOpenStateResult = {
  floatingTerminalOpen: boolean
  setFloatingTerminalOpenWithFocus: (nextOpen: SetStateAction<boolean>) => void
  floatingWorkspaceTourInteractionSnapshotRef: RefObject<FloatingWorkspaceTourInteractionSnapshot | null>
  cancelFloatingTerminalReturnFocusFrame: () => void
}

// Why: the floating workspace is a transient overlay; hotkey minimize should
// return keyboard focus to the surface the user was working in before it.
export function useFloatingTerminalOpenState(
  floatingTerminalEnabled: boolean
): UseFloatingTerminalOpenStateResult {
  const [floatingTerminalOpen, setFloatingTerminalOpen] = useState(false)
  const floatingWorkspaceTourInteractionSnapshotRef =
    useRef<FloatingWorkspaceTourInteractionSnapshot | null>(null)
  const floatingTerminalReturnFocusRef = useRef<HTMLElement | null>(null)
  const floatingTerminalReturnFocusFrameRef = useRef<number | null>(null)

  const cancelFloatingTerminalReturnFocusFrame = useCallback((): void => {
    if (floatingTerminalReturnFocusFrameRef.current === null) {
      return
    }
    cancelAnimationFrame(floatingTerminalReturnFocusFrameRef.current)
    floatingTerminalReturnFocusFrameRef.current = null
  }, [])

  const rememberFloatingTerminalReturnFocus = useCallback((): void => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) {
      floatingTerminalReturnFocusRef.current = null
      return
    }
    if (
      active.closest('[data-floating-terminal-panel]') ||
      active.closest('[data-floating-terminal-toggle]')
    ) {
      return
    }
    floatingTerminalReturnFocusRef.current = active
  }, [])

  const restoreFloatingTerminalReturnFocus = useCallback((): void => {
    const target = floatingTerminalReturnFocusRef.current
    floatingTerminalReturnFocusRef.current = null
    if (!target || !document.contains(target)) {
      return
    }
    cancelFloatingTerminalReturnFocusFrame()
    floatingTerminalReturnFocusFrameRef.current = requestAnimationFrame(() => {
      floatingTerminalReturnFocusFrameRef.current = null
      if (!document.contains(target)) {
        return
      }
      target.focus({ preventScroll: true })
    })
  }, [cancelFloatingTerminalReturnFocusFrame])

  const setFloatingTerminalOpenWithFocus = useCallback(
    (nextOpen: SetStateAction<boolean>): void => {
      const resolvedOpen =
        typeof nextOpen === 'function' ? nextOpen(floatingTerminalOpen) : nextOpen
      // Why: recordFeatureInteraction updates Zustand subscribers; doing it
      // inside React's state updater logs a render-phase update warning.
      if (resolvedOpen && !floatingTerminalOpen) {
        const state = useAppStore.getState()
        floatingWorkspaceTourInteractionSnapshotRef.current =
          createFloatingWorkspaceTourInteractionSnapshot(state)
        rememberFloatingTerminalReturnFocus()
      } else if (!resolvedOpen && floatingTerminalOpen) {
        restoreFloatingTerminalReturnFocus()
      }
      setFloatingTerminalOpen(resolvedOpen)
    },
    [floatingTerminalOpen, rememberFloatingTerminalReturnFocus, restoreFloatingTerminalReturnFocus]
  )

  useEffect(() => {
    const toggleFloatingTerminal = (): void => {
      if (floatingTerminalEnabled) {
        setFloatingTerminalOpenWithFocus((open) => !open)
      }
    }
    window.addEventListener(TOGGLE_FLOATING_TERMINAL_EVENT, toggleFloatingTerminal)
    return () => window.removeEventListener(TOGGLE_FLOATING_TERMINAL_EVENT, toggleFloatingTerminal)
  }, [floatingTerminalEnabled, setFloatingTerminalOpenWithFocus])

  useEffect(() => {
    if (!floatingTerminalEnabled) {
      setFloatingTerminalOpenWithFocus(false)
    }
  }, [floatingTerminalEnabled, setFloatingTerminalOpenWithFocus])

  return {
    floatingTerminalOpen,
    setFloatingTerminalOpenWithFocus,
    floatingWorkspaceTourInteractionSnapshotRef,
    cancelFloatingTerminalReturnFocusFrame
  }
}
