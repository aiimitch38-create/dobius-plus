import { useLayoutEffect } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'

type CloseAction =
  | 'closeSettingsPage'
  | 'closeSkillsPage'
  | 'closeAutomationsPage'
  | 'closeTaskPage'
  | 'closeMobilePage'

function patch(action: CloseAction, fn: () => void): Partial<Pick<AppState, CloseAction>> {
  return { [action]: fn }
}

// Why: embedded Classic pages (Settings, Skills, Automations, Tasks, Mobile) close themselves through a store
// action that sets activeView to the page's previous view, dropping the user out
// of the Board. While the studio is mounted, that action closes the studio
// instead; the original is restored on unmount.
export function useStudioCloseOverride(action: CloseAction, onClose: () => void): void {
  useLayoutEffect(() => {
    const original = useAppStore.getState()[action]
    useAppStore.setState(patch(action, onClose))
    return () => {
      if (useAppStore.getState()[action] === onClose) {
        useAppStore.setState(patch(action, original))
      }
    }
  }, [action, onClose])
}
