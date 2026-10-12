import { translate } from '@/i18n/i18n'
import { searchKeywords } from './settings-search-keywords'

export function getAgentSandboxTitle(): string {
  return translate(
    'auto.components.settings.agent-sandbox-copy.title',
    'Agent sandbox (recommended)'
  )
}

export function getAgentSandboxDescription(): string {
  return translate(
    'auto.components.settings.agent-sandbox-copy.description',
    "Commands run by Claude agents can only write to the agent's working folder, its git repository, temp folders and package caches, and cannot read other agents' memory or saved credentials. Turning this off lets agents write anywhere in your home folder. Hook, settings and shell startup files stay protected either way."
  )
}

export function getAgentSandboxSearchKeywords(): string[] {
  return searchKeywords(['sandbox', 'security', 'write', 'home folder', 'agents'])
}
