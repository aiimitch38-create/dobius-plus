// Why: the Board needs a workspace. With none active (fresh install, every
// workspace closed) Classic renders as the terminal view so Landing and
// onboarding stay reachable; the Board returns once a workspace is active.
export function resolveEffectiveActiveView<V extends string>(
  view: V,
  activeWorktreeId: string | null
): V | 'terminal' {
  return view === 'board' && activeWorktreeId === null ? 'terminal' : view
}
