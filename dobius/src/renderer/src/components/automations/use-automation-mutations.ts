import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { AutomationRun } from '../../../../shared/automations-types'
import { getAutomationRunStatusLabel } from './automation-page-parts'

export type AutomationMutationRunner = (
  automationId: string,
  mutation: () => Promise<void>,
  fallbackErrorMessage: string
) => Promise<void>

/**
 * Why a run returned by runNow did not start, or null when it was queued or
 * launched. The service reports a refused run (Pause crew, unreachable host,
 * no window) as a resolved run with a skipped/failed status, not a rejection.
 */
export function getAutomationRunNowFailureDetail(run: AutomationRun): string | null {
  if (!run.status.startsWith('skipped') && run.status !== 'dispatch_failed') {
    return null
  }
  return run.error?.trim() || getAutomationRunStatusLabel(run.status)
}

/**
 * Runs Run Now / Pause / Resume / Delete for one automation at a time. A rejection
 * is shown as an error toast and the list is reloaded so it shows what the host
 * actually has; the pending mark is always cleared.
 */
export function useAutomationMutations(refresh: () => Promise<void>): {
  pendingAutomationIds: ReadonlySet<string>
  runAutomationMutation: AutomationMutationRunner
} {
  const inFlightRef = useRef(new Set<string>())
  const [pendingAutomationIds, setPendingAutomationIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  const runAutomationMutation = useCallback<AutomationMutationRunner>(
    async (automationId, mutation, fallbackErrorMessage) => {
      if (inFlightRef.current.has(automationId)) {
        return
      }
      inFlightRef.current.add(automationId)
      setPendingAutomationIds(new Set(inFlightRef.current))
      try {
        await mutation()
      } catch (error) {
        toast.error(error instanceof Error && error.message ? error.message : fallbackErrorMessage)
        try {
          await refresh()
        } catch (refreshError) {
          console.error(
            '[automations] reload after a failed action failed:',
            refreshError instanceof Error ? refreshError.message : String(refreshError)
          )
        }
      } finally {
        inFlightRef.current.delete(automationId)
        setPendingAutomationIds(new Set(inFlightRef.current))
      }
    },
    [refresh]
  )

  return { pendingAutomationIds, runAutomationMutation }
}
