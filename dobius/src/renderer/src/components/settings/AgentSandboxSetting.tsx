import type { GlobalSettings } from '../../../../shared/types'
import { getAgentSandboxDescription, getAgentSandboxTitle } from './agent-sandbox-copy'
import { SettingsSwitchRow } from './SettingsFormControls'

type AgentSandboxSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

export function AgentSandboxSetting({
  settings,
  updateSettings
}: AgentSandboxSettingProps): React.JSX.Element {
  // Why: absent means on; main reads the same `!== false` rule.
  const enabled = settings.agentSandboxEnabled !== false
  return (
    <section className="space-y-3">
      <SettingsSwitchRow
        label={getAgentSandboxTitle()}
        description={getAgentSandboxDescription()}
        checked={enabled}
        onChange={() => updateSettings({ agentSandboxEnabled: !enabled })}
        ariaLabel={getAgentSandboxTitle()}
      />
    </section>
  )
}
