import { describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/types'
import { getAgentSandboxTitle } from './agent-sandbox-copy'
import { AgentSandboxSetting } from './AgentSandboxSetting'

type SwitchRowProps = { ariaLabel?: string; checked: boolean; onChange: () => void }

function switchRow(settings: GlobalSettings, updateSettings: () => void): SwitchRowProps {
  const section = AgentSandboxSetting({ settings, updateSettings })
  const row = (section.props as { children: { props: SwitchRowProps } }).children
  return row.props
}

describe('AgentSandboxSetting', () => {
  it('is on by default and turns off with the next value', () => {
    expect(getDefaultSettings('/tmp').agentSandboxEnabled).toBe(true)
    const updateSettings = vi.fn()
    const row = switchRow(getDefaultSettings('/tmp'), updateSettings)
    expect(row.ariaLabel).toBe(getAgentSandboxTitle())
    expect(row.checked).toBe(true)
    row.onChange()
    expect(updateSettings).toHaveBeenCalledWith({ agentSandboxEnabled: false })
  })

  it('treats a missing value as on and turns back on from off', () => {
    const { agentSandboxEnabled: _omitted, ...legacy } = getDefaultSettings('/tmp')
    expect(switchRow(legacy as GlobalSettings, vi.fn()).checked).toBe(true)
    const updateSettings = vi.fn()
    const row = switchRow(
      { ...getDefaultSettings('/tmp'), agentSandboxEnabled: false },
      updateSettings
    )
    expect(row.checked).toBe(false)
    row.onChange()
    expect(updateSettings).toHaveBeenCalledWith({ agentSandboxEnabled: true })
  })
})
