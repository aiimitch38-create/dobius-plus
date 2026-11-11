import { useEffect } from 'react'
import type { AppState } from '@/store'
import { applyDocumentTheme } from '@/lib/document-theme'
import { buildAppFontFamily } from '@/lib/app-font-family'
import { scheduleRuntimeGraphSync } from '../runtime/sync-runtime-graph'

// Why: re-check the clock often enough that "System" visibly flips through
// the day without requiring an app restart, without redoing the work on
// every render.
const SYSTEM_THEME_REEVALUATE_INTERVAL_MS = 60_000

// Why: applies the theme setting (System/Dark/Neon) to the document. Only
// 'system' needs a live re-check, since 'dark'/'neon' are static choices.
export function useAppearanceSync(settings: AppState['settings']): void {
  useEffect(() => {
    if (!settings) {
      return undefined
    }

    applyDocumentTheme(settings.theme)

    if (settings.theme !== 'system') {
      return undefined
    }

    const interval = window.setInterval(() => {
      applyDocumentTheme('system')
      // Why: a timed re-resolution does not mutate the store, so mobile
      // terminal colors need an explicit graph republish.
      scheduleRuntimeGraphSync()
    }, SYSTEM_THEME_REEVALUATE_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [settings?.theme])

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--app-font-family',
      buildAppFontFamily(settings?.appFontFamily)
    )
  }, [settings?.appFontFamily])
}
