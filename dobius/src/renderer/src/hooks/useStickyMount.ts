import { useRef } from 'react'

// Why: once `active` goes true, stay mounted even if `active` later goes
// false — e.g. Terminal/Communications must not remount (and lose live
// connections/state) just because the user briefly navigated away.
export function useStickyMount(active: boolean): boolean {
  const hasMountedRef = useRef(false)
  if (active) {
    hasMountedRef.current = true
  }
  return active || hasMountedRef.current
}
