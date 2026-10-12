// @vitest-environment happy-dom

// #122 F11: the existing-user telemetry notice announces that Dobius+ collects
// usage data, so it must stay hidden in a build that cannot send any.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../../shared/types'
import type { TelemetryConsentState } from '../../../shared/telemetry-consent-types'

const { getConsentStateMock, storeState } = vi.hoisted(() => ({
  getConsentStateMock: vi.fn<() => Promise<TelemetryConsentState>>(),
  storeState: { settings: null as GlobalSettings | null, fetchSettings: async () => {} }
}))
vi.mock('../lib/telemetry', () => ({ getConsentState: getConsentStateMock }))
vi.mock('../store', () => ({
  useAppStore: (selector: (state: typeof storeState) => unknown) => selector(storeState)
}))
vi.mock('./FirstLaunchBanner', () => ({
  FirstLaunchBanner: () => createElement('div', { 'data-testid': 'first-launch-banner' })
}))

import { TelemetryFirstLaunchSurface } from './TelemetryFirstLaunchSurface'

const roots: Root[] = []

async function renderSurface(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(createElement(TelemetryFirstLaunchSurface))
  })
  await act(async () => {
    await Promise.resolve()
  })
  return container
}

describe('TelemetryFirstLaunchSurface — transport availability (#122 F11)', () => {
  beforeEach(() => {
    getConsentStateMock.mockReset()
    storeState.settings = {
      telemetry: { installId: 'id', existedBeforeTelemetryRelease: true, optedIn: null }
    } as unknown as GlobalSettings
  })
  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount())
    }
    document.body.replaceChildren()
  })

  it('hides the notice when this build cannot send usage data', async () => {
    getConsentStateMock.mockResolvedValue({
      effective: 'disabled',
      reason: 'transport_unavailable'
    })
    const container = await renderSurface()
    expect(container.querySelector('[data-testid="first-launch-banner"]')).toBeNull()
  })

  it('shows the notice to an existing user awaiting it when the build can send', async () => {
    getConsentStateMock.mockResolvedValue({ effective: 'pending_banner' })
    const container = await renderSurface()
    expect(container.querySelector('[data-testid="first-launch-banner"]')).not.toBeNull()
  })

  it('does not ask main at all for users outside the notice cohort', async () => {
    storeState.settings = {
      telemetry: { installId: 'id', existedBeforeTelemetryRelease: false, optedIn: true }
    } as unknown as GlobalSettings
    const container = await renderSurface()
    expect(container.querySelector('[data-testid="first-launch-banner"]')).toBeNull()
    expect(getConsentStateMock).not.toHaveBeenCalled()
  })
})
