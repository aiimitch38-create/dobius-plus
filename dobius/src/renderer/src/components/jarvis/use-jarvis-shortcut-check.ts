import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'

export const JARVIS_SHORTCUT_UNAVAILABLE_TEXT =
  "Jarvis shortcut (Cmd+T) couldn't be registered. Another app may be using it. See Settings > Voice."

export const OPEN_VOICE_SETTINGS_ACTION = {
  label: 'Open Settings',
  onClick: (): void => {
    useAppStore.getState().openSettingsTarget({ pane: 'voice', repoId: null })
    useAppStore.getState().openSettingsPage()
  }
}

/**
 * Toasts once if main could not grab the Cmd+T shortcut.
 *
 * Why ask once on mount (#122-F9): main tries the grab at launch, before any
 * listener exists, so its error broadcast is never seen. Without this, a
 * refused grab showed only in Settings.
 * Why no cleanup cancel: StrictMode re-runs the effect and the ref would then
 * skip the only check.
 */
export function useJarvisShortcutCheck(jarvisEnabled: boolean): void {
  const shortcutCheckedRef = useRef(false)
  useEffect(() => {
    if (!jarvisEnabled || shortcutCheckedRef.current) {
      return
    }
    shortcutCheckedRef.current = true
    void window.api.jarvis
      .status()
      .then((status) => {
        if (!status.shortcutActive) {
          toast(JARVIS_SHORTCUT_UNAVAILABLE_TEXT, { action: OPEN_VOICE_SETTINGS_ACTION })
        }
      })
      .catch(() => undefined)
  }, [jarvisEnabled])
}
