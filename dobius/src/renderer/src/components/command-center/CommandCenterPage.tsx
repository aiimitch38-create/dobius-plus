import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { StudioShell } from './StudioShell'
import type { StudioAction, StudioResource } from './studio-state'

export default function CommandCenterPage(): React.JSX.Element {
  const tabs = useAppStore((state) => state.unifiedTabsByWorktree)
  const resources = useMemo(
    () =>
      Object.values(tabs)
        .flat()
        .map((tab) => ({
          id: tab.id,
          title: tab.customLabel || tab.label,
          kind: tab.contentType,
          worktreeId: tab.worktreeId
        })),
    [tabs]
  )
  const openResource = (resource: StudioResource): void => {
    const state = useAppStore.getState()
    activateAndRevealWorktree(resource.worktreeId)
    state.setActiveView('terminal')
    state.activateTab(resource.id)
  }
  const action = (target: StudioAction): void => {
    const state = useAppStore.getState()
    if (target === 'terminal' || target === 'browser') {
      if (!state.activeWorktreeId) {
        state.openModal('worktree-palette')
        return
      }
      if (target === 'browser') {
        state.createBrowserTab(state.activeWorktreeId, 'about:blank')
      }
      state.setActiveView('terminal')
      return
    }
    if (target === 'automations') {
      state.openAutomationsPage()
    } else if (target === 'skills') {
      state.openSkillsPage()
    } else {
      state.setActiveView(
        target === 'system' ? 'settings' : target === 'agents' ? 'dashboard' : 'buzz'
      )
    }
  }
  return <StudioShell resources={resources} onResource={openResource} onAction={action} />
}
