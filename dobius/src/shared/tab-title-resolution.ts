import { formatAgentTabLabel } from './agent-names'
import type { Tab, TerminalTab } from './types'

export function resolveTerminalTabTitle(
  tab: Pick<TerminalTab, 'customTitle' | 'quickCommandLabel' | 'generatedTitle' | 'title'> &
    Partial<Pick<TerminalTab, 'agentName'>>,
  generatedTitlesEnabled: boolean,
  fallback = ''
): string {
  return (
    tab.customTitle?.trim() ||
    tab.quickCommandLabel?.trim() ||
    formatAgentTabLabel(
      tab.agentName,
      (generatedTitlesEnabled ? tab.generatedTitle?.trim() : '') || tab.title?.trim() || ''
    ) ||
    fallback
  )
}

export function resolveUnifiedTabLabel(
  tab:
    | (Pick<Tab, 'customLabel' | 'quickCommandLabel' | 'generatedLabel' | 'label'> &
        Partial<Pick<Tab, 'agentName'>>)
    | undefined,
  generatedTitlesEnabled: boolean,
  fallback = ''
): string {
  return (
    tab?.customLabel?.trim() ||
    tab?.quickCommandLabel?.trim() ||
    formatAgentTabLabel(
      tab?.agentName,
      (generatedTitlesEnabled ? tab?.generatedLabel?.trim() : '') || tab?.label?.trim() || ''
    ) ||
    fallback
  )
}
