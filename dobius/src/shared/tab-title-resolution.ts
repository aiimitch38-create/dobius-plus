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

// Why: the "Name · topic" label is display-only. Provider identity and status
// detection must parse the title without the agent name, or a Pi title like
// "π - ~/repo" turns into "Juniper" and no longer identifies the agent.
export function resolveTerminalTabDetectionTitle(
  tab: Pick<TerminalTab, 'customTitle' | 'quickCommandLabel' | 'generatedTitle' | 'title'>,
  generatedTitlesEnabled: boolean,
  fallback = ''
): string {
  return resolveTerminalTabTitle({ ...tab, agentName: undefined }, generatedTitlesEnabled, fallback)
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
