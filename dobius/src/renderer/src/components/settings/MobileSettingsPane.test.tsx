// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GlobalSettings } from '../../../../shared/types'

type MockState = {
  settingsSearchQuery: string
  settings: Partial<GlobalSettings> | null
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void>
}

const storeState: MockState = {
  settingsSearchQuery: '',
  settings: null,
  updateSettings: vi.fn(async () => undefined)
}

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: MockState) => unknown) => selector(storeState)
}))

vi.mock('./MobilePane', () => ({
  MobilePane: () => <div data-testid="mobile-pane" />
}))

vi.mock('@/components/terminal-pane/pane-helpers', () => ({
  isMacUserAgent: () => false
}))

import { MobileSettingsPane } from './MobileSettingsPane'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPane(settings: Partial<GlobalSettings> | null) {
  storeState.settings = settings
  const updateSettings = vi.fn(async () => undefined)
  storeState.updateSettings = updateSettings
  const user = userEvent.setup()
  render(<MobileSettingsPane />)
  const toggle = screen.getByRole('switch', {
    name: 'Phone Listener (takes effect on next launch)'
  })
  return { user, updateSettings, toggle }
}

describe('MobileSettingsPane phone listener switch', () => {
  it('renders off when the setting is missing (old settings files)', () => {
    const { toggle } = renderPane({})
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('renders on when the setting is true', () => {
    const { toggle } = renderPane({ mobileListenerEnabled: true })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('saves mobileListenerEnabled through the settings update path', async () => {
    const { user, updateSettings, toggle } = renderPane({ mobileListenerEnabled: false })
    await user.click(toggle)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({ mobileListenerEnabled: true })
  })

  it('turns the listener off when it is on', async () => {
    const { user, updateSettings, toggle } = renderPane({ mobileListenerEnabled: true })
    await user.click(toggle)
    expect(updateSettings).toHaveBeenCalledWith({ mobileListenerEnabled: false })
  })

  it('says the change applies on the next launch and what the listener does', () => {
    renderPane({})
    expect(screen.getAllByText('Phone Listener (takes effect on next launch)').length).toBe(1)
    expect(
      screen.getByText(
        'Lets phones on your local network connect to Dobius+. Changes take effect the next time Dobius+ starts.'
      )
    ).toBeInTheDocument()
  })
})
