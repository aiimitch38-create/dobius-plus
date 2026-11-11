import type { GlobalSettings } from '../../../shared/types'

export type DocumentThemePreference = GlobalSettings['theme']
export type ResolvedAppearance = 'light' | 'dark' | 'neon'

export const THEME_TRANSITION_DISABLED_CLASS = 'theme-transition-disabled'

// Why: "System" resolves off local time of day, not OS dark-mode preference
// (explicit product decision — "it changes based on the time").
export const SYSTEM_DAY_START_HOUR = 7
export const SYSTEM_DAY_END_HOUR = 19

type ThemeClassList = {
  add: (...tokens: string[]) => void
  remove: (...tokens: string[]) => void
  toggle: (token: string, force?: boolean) => boolean
}

type ThemeRoot = {
  classList: ThemeClassList
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
}

type ThemeAnimationFrame = (callback: FrameRequestCallback) => number
type ThemeCancelAnimationFrame = (handle: number) => void

type ApplyDocumentThemeOptions = {
  root?: ThemeRoot
  now?: Date
  requestAnimationFrame?: ThemeAnimationFrame
  cancelAnimationFrame?: ThemeCancelAnimationFrame
  disableTransitions?: boolean
}

let pendingTransitionDisableFrames: number[] = []

function cancelPendingTransitionDisableFrames(cancelFrame: ThemeCancelAnimationFrame): void {
  for (const frameId of pendingTransitionDisableFrames) {
    cancelFrame(frameId)
  }
  pendingTransitionDisableFrames = []
}

/** Local daytime window (inclusive start, exclusive end). */
export function isDaytime(now: Date = new Date()): boolean {
  const hour = now.getHours()
  return hour >= SYSTEM_DAY_START_HOUR && hour < SYSTEM_DAY_END_HOUR
}

/**
 * Resolve a theme preference to the appearance that should actually be
 * painted. 'system' never resolves to 'neon' — Neon is only reached by
 * explicitly selecting it.
 */
export function resolveAppearance(
  theme: DocumentThemePreference,
  now: Date = new Date()
): ResolvedAppearance {
  if (theme === 'dark') {
    return 'dark'
  }
  if (theme === 'neon') {
    return 'neon'
  }
  return isDaytime(now) ? 'light' : 'dark'
}

export function resolveDocumentTheme(theme: DocumentThemePreference, now?: Date): boolean {
  return resolveAppearance(theme, now) !== 'light'
}

export function applyDocumentTheme(
  theme: DocumentThemePreference,
  options: ApplyDocumentThemeOptions = {}
): void {
  const root = options.root ?? document.documentElement
  const disableTransitions = options.disableTransitions ?? true
  const appearance = resolveAppearance(theme, options.now)
  const shouldUseDarkTheme = appearance !== 'light'

  if (disableTransitions) {
    root.classList.add(THEME_TRANSITION_DISABLED_CLASS)
  }

  root.classList.toggle('dark', shouldUseDarkTheme)
  // Mirror with `light` so consumers can observe the resolved theme
  // symmetrically (Tailwind keys only on `dark`, so this is style-neutral).
  root.classList.toggle('light', !shouldUseDarkTheme)

  if (appearance === 'neon') {
    root.setAttribute('data-appearance', 'neon')
  } else {
    root.removeAttribute('data-appearance')
  }

  if (!disableTransitions) {
    return
  }

  const requestFrame = options.requestAnimationFrame ?? window.requestAnimationFrame.bind(window)
  const cancelFrame = options.cancelAnimationFrame ?? window.cancelAnimationFrame.bind(window)
  cancelPendingTransitionDisableFrames(cancelFrame)

  // Why: two frames lets the root theme class recalculate before restoring
  // normal hover/collapse transitions, preventing staggered color fades.
  const firstFrame = requestFrame(() => {
    pendingTransitionDisableFrames = pendingTransitionDisableFrames.filter(
      (id) => id !== firstFrame
    )
    const secondFrame = requestFrame(() => {
      pendingTransitionDisableFrames = pendingTransitionDisableFrames.filter(
        (id) => id !== secondFrame
      )
      root.classList.remove(THEME_TRANSITION_DISABLED_CLASS)
    })
    pendingTransitionDisableFrames.push(secondFrame)
  })
  pendingTransitionDisableFrames.push(firstFrame)
}
