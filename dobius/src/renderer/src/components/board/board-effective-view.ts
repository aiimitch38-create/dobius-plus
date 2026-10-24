// Why: the Board needs a workspace. With none active (fresh install, every
// workspace closed) Classic renders as the terminal view so Landing and
// onboarding stay reachable; the Board returns once a workspace is active.
export function resolveEffectiveActiveView<V extends string>(
  view: V,
  activeWorktreeId: string | null
): V | 'terminal' {
  return view === 'board' && activeWorktreeId === null ? 'terminal' : view
}

export type AppLook = 'board' | 'classic'

// Why: Settings > Appearance > "App look". Unset (and anything unrecognized)
// reads as the Board, so nobody who never touched the setting sees a change.
export function resolveAppLook(settings: { appLook?: AppLook } | null | undefined): AppLook {
  return settings?.appLook === 'classic' ? 'classic' : 'board'
}

export function appLookView(look: AppLook): 'board' | 'terminal' {
  return look === 'classic' ? 'terminal' : 'board'
}

// Why: the store boots on the Board. Only that untouched default is swapped for
// Classic; any other view already chosen this launch (Tasks, Settings, ...) wins.
export function resolveStartupActiveView<V extends string>(
  view: V,
  settings: { appLook?: AppLook } | null | undefined
): V | 'terminal' {
  return view === 'board' && resolveAppLook(settings) === 'classic' ? 'terminal' : view
}

// Why: a live change moves the current window to the chosen look. The control
// lives on the Settings page, so when Settings is open the look underneath it
// (what closing Settings returns to) is switched instead of yanking the user
// out of Settings. Other full-page views are left alone.
export function appLookViewUpdate(
  state: { activeView: string; previousViewBeforeSettings: string },
  look: AppLook
):
  | { activeView: 'board' | 'terminal' }
  | { previousViewBeforeSettings: 'board' | 'terminal' }
  | null {
  const target = appLookView(look)
  const isLookView = (view: string): boolean => view === 'board' || view === 'terminal'
  if (isLookView(state.activeView)) {
    return state.activeView === target ? null : { activeView: target }
  }
  if (state.activeView === 'settings' && isLookView(state.previousViewBeforeSettings)) {
    return state.previousViewBeforeSettings === target
      ? null
      : { previousViewBeforeSettings: target }
  }
  return null
}
