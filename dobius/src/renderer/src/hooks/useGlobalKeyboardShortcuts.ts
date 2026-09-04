import { useEffect, useRef } from 'react'
import {
  dispatchGlobalKeyboardShortcut,
  type GlobalShortcutDispatchState
} from './dispatch-global-keyboard-shortcut'
import {
  ModifierDoubleTapDetector,
  toModifierDoubleTapEvent
} from '../../../shared/modifier-double-tap-detector'

export type UseGlobalKeyboardShortcutsParams = GlobalShortcutDispatchState

// Why: window key listeners are global and long-lived; keep one registration
// while letting the handler read current shortcut state on each key event via
// a ref, instead of re-registering the listener on every render.
export function useGlobalKeyboardShortcuts(params: UseGlobalKeyboardShortcutsParams): void {
  const globalShortcutStateRef = useRef(params)
  globalShortcutStateRef.current = params

  useEffect(() => {
    const doubleTapDetector = new ModifierDoubleTapDetector()

    const onKeyDown = (e: KeyboardEvent): void => {
      const detected = doubleTapDetector.process(
        toModifierDoubleTapEvent({
          type: 'keyDown',
          code: e.code,
          key: e.key,
          shift: e.shiftKey,
          control: e.ctrlKey,
          alt: e.altKey,
          meta: e.metaKey,
          isAutoRepeat: e.repeat
        }),
        Date.now()
      )
      if (e.repeat) {
        return
      }
      if (detected) {
        // Synthetic input: no key/modifier flags, so only DoubleTap bindings match.
        dispatchGlobalKeyboardShortcut(
          {
            doubleTapModifier: detected.modifier,
            target: e.target,
            defaultPrevented: e.defaultPrevented,
            preventDefault: () => e.preventDefault()
          },
          globalShortcutStateRef.current
        )
        return
      }
      dispatchGlobalKeyboardShortcut(
        {
          key: e.key,
          code: e.code,
          altKey: e.altKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          target: e.target,
          defaultPrevented: e.defaultPrevented,
          preventDefault: () => e.preventDefault()
        },
        globalShortcutStateRef.current
      )
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      doubleTapDetector.process(
        toModifierDoubleTapEvent({
          type: 'keyUp',
          code: e.code,
          key: e.key,
          shift: e.shiftKey,
          control: e.ctrlKey,
          alt: e.altKey,
          meta: e.metaKey
        }),
        Date.now()
      )
    }

    // Why: a window blur mid-gesture must not leave the detector armed.
    const onBlur = (): void => doubleTapDetector.reset()

    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
