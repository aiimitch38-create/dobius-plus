import { useEffect } from 'react'
import type { AppState } from '@/store'
import { applyDocumentTheme } from '@/lib/document-theme'
import { applyAppSkin } from '@/lib/app-skin'
import { buildAppFontFamily } from '@/lib/app-font-family'
import { scheduleRuntimeGraphSync } from '../runtime/sync-runtime-graph'

// Why: applies theme/skin/font-family settings to the document. Order
// matters — the skin effect runs after the theme effect so the skin owns the
// dark/light class while active; clearing it (`none`) reverts to whatever
// the theme effect already set.
export function useAppearanceSync(settings: AppState['settings']): void {
  useEffect(() => {
    if (!settings) {
      return
    }

    if (settings.theme === 'dark') {
      applyDocumentTheme('dark')
      return undefined
    } else if (settings.theme === 'light') {
      applyDocumentTheme('light')
      return undefined
    } else {
      // system
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      applyDocumentTheme('system')
      const handler = (): void => {
        applyDocumentTheme('system')
        // Why: system theme changes do not mutate the store, so mobile
        // terminal colors need an explicit graph republish.
        scheduleRuntimeGraphSync()
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [settings])

  useEffect(() => {
    applyAppSkin(settings?.appSkin)
  }, [settings?.appSkin, settings?.theme])

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--app-font-family',
      buildAppFontFamily(settings?.appFontFamily)
    )
  }, [settings?.appFontFamily])
}
