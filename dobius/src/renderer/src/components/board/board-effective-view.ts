// Why: the Board needs a workspace. With none active (fresh install, every
// workspace closed) the terminal view renders Landing so Landing and
// onboarding stay reachable; the Board returns once a workspace is active.
export function resolveEffectiveActiveView<V extends string>(
  view: V,
  activeWorktreeId: string | null
): V | 'terminal' {
  return view === 'board' && activeWorktreeId === null ? 'terminal' : view
}

export type AppLook = 'board' | 'classic'

// Why: the Classic look is retired. Profiles saved with appLook 'classic' (the
// old Settings > Appearance > "App look") must keep opening on the Board, so
// the saved value is accepted but never honored.
export function resolveAppLook(_settings: { appLook?: AppLook } | null | undefined): 'board' {
  return 'board'
}

// Why: the Classic terminal view is no longer a destination. Flows that navigate
// "to the workspace" (notifications, links, activation, creation) still ask for
// 'terminal'; the store lands them on the Board, which
// resolveEffectiveActiveView renders as Landing while no workspace is active.
// Routing it here keeps those callers untouched.
export function resolveRequestedActiveView<V extends string>(
  view: V
): Exclude<V, 'terminal'> | 'board' {
  return view === 'terminal' ? 'board' : (view as Exclude<V, 'terminal'>)
}

// Why: page actions (Tasks, Automations, Mobile, Settings, Skills) open as Board
// studios while the Board is on screen. With no active workspace the Board
// renders as Landing (see resolveEffectiveActiveView), so there is no studio
// host and the Classic page is still the right destination.
export function isBoardSurfaceActive(state: {
  activeView: string
  activeWorktreeId: string | null | undefined
}): boolean {
  return state.activeView === 'board' && typeof state.activeWorktreeId === 'string'
}
