import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getAutomationListTarget, type AutomationHostTarget } from './automation-host-client'

/**
 * The host whose automations the page lists. Why: selecting only the runtime
 * environment id keeps the target stable across unrelated settings changes
 * (theme, font, ...), so the page's load effects do not refetch on them.
 */
export function useAutomationListTarget(): AutomationHostTarget {
  const activeRuntimeEnvironmentId = useAppStore((s) => s.settings?.activeRuntimeEnvironmentId)
  return useMemo(
    () => getAutomationListTarget({ activeRuntimeEnvironmentId }),
    [activeRuntimeEnvironmentId]
  )
}
