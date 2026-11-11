import { useEffect } from 'react'
import type { AppState } from '@/store'
import { applyDocumentTheme } from '@/lib/document-theme'
import { applyAppSkin } from '@/lib/app-skin'
import { buildAppFontFamily } from '@/lib/app-font-family'
import { scheduleRuntimeGraphSync } from '../runtime/sync-runtime-graph'

// Why: applies theme/skin/font-family settings to the document. The theme
// effect alone owns the dark/light class; the skin effect only applies the
// skin's own color tokens and never flips dark/light against the user's
// explicit Theme setting.
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
