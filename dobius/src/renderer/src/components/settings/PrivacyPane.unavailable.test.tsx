// @vitest-environment happy-dom

// #122 F11: when this build cannot send usage data, the "Share anonymous
// usage data" switch must read off, be disabled, and say why, without
// rewriting the stored preference.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../../shared/types'
import type { TelemetryConsentState } from '../../../../shared/telemetry-consent-types'

const { getConsentStateMock, setOptInMock, fetchSettingsMock } = vi.hoisted(() => ({
  getConsentStateMock: vi.fn<() => Promise<TelemetryConsentState>>(),
  setOptInMock: vi.fn<(optedIn: boolean) => Promise<void>>(),
  fetchSettingsMock: vi.fn<() => Promise<void>>()
}))
vi.mock('../../lib/telemetry', () => ({
  PRIVACY_URL: 'https://example.invalid/telemetry',
  getConsentState: getConsentStateMock,
  setOptIn: setOptInMock
}))
vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { fetchSettings: () => Promise<void> }) => unknown) =>
    selector({ fetchSettings: fetchSettingsMock })
}))
vi.mock('./PrivacyDiagnosticsSection', () => ({ PrivacyDiagnosticsSection: () => null }))

import { PrivacyPane } from './PrivacyPane'

function buildSettings(optedIn: boolean | null): GlobalSettings {
  return {
    telemetry: { installId: 'test-install-id', existedBeforeTelemetryRelease: false, optedIn }
  } as unknown as GlobalSettings
}

const roots: Root[] = []

async function renderPane(settings: GlobalSettings): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(createElement(PrivacyPane, { settings }))
  })
  await act(async () => {
    await Promise.resolve()
  })
  return container
}

describe('PrivacyPane — transport unavailable (#122 F11)', () => {
  beforeEach(() => {
    getConsentStateMock.mockReset()
    setOptInMock.mockReset()
    fetchSettingsMock.mockReset()
  })
  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount())
    }
    document.body.replaceChildren()
  })

  it('shows an opted-in user an off, disabled switch with the reason', async () => {
    getConsentStateMock.mockResolvedValue({
      effective: 'disabled',
      reason: 'transport_unavailable'
    })
    const settings = buildSettings(true)
    const container = await renderPane(settings)

    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.disabled).toBe(true)
    expect(container.textContent).toContain('Not available in this build')
    expect(container.textContent).toContain('This build of Dobius+ does not send usage data.')
    expect(container.textContent).not.toContain('Dobius+ sends anonymous counts')

    await act(async () => {
      toggle.click()
    })
    expect(setOptInMock).not.toHaveBeenCalled()
    expect(settings.telemetry?.optedIn).toBe(true)
  })

  it('keeps the switch live when the build can send', async () => {
    getConsentStateMock.mockResolvedValue({ effective: 'enabled' })
    const container = await renderPane(buildSettings(true))

    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle.disabled).toBe(false)
    expect(container.textContent).not.toContain('Not available in this build')
    expect(container.textContent).toContain('Dobius+ sends anonymous counts')
  })
})
