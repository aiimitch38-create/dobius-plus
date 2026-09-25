// #122 F11: `telemetry:getConsentState` must tell the Privacy pane when this
// build cannot transmit at all, so the switch never reads as "sharing".

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/types'
import type { Store } from '../persistence'

const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
const { handleMock, transportAvailableMock } = vi.hoisted(() => ({
  handleMock: vi.fn(
    (channel: string, handler: (_event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  ),
  transportAvailableMock: vi.fn<() => boolean>()
}))

vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }))
vi.mock('../telemetry/client', () => ({
  isTelemetryTransportAvailable: transportAvailableMock,
  track: vi.fn(),
  setOptIn: vi.fn(),
  persistBannerAcknowledgeWithoutEmitting: vi.fn()
}))
vi.mock('../telemetry/burst-cap', () => ({ consumeConsentMutationToken: vi.fn(() => true) }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn(() => ({})) }))
vi.mock('../telemetry/onboarding-cohort-classifier', () => ({
  getOnboardingCohortAtEmit: vi.fn(() => ({}))
}))

import { _resetStoreForTests, registerTelemetryHandlers } from './telemetry'

function getConsentState(optedIn: boolean | null): unknown {
  const settings = {
    telemetry: { installId: 'x', existedBeforeTelemetryRelease: false, optedIn }
  } as unknown as GlobalSettings
  registerTelemetryHandlers({ getSettings: () => settings } as unknown as Store)
  return handlers.get('telemetry:getConsentState')!({})
}

describe('telemetry:getConsentState transport availability', () => {
  beforeEach(() => {
    handlers.clear()
    handleMock.mockClear()
    transportAvailableMock.mockReset()
    _resetStoreForTests()
    vi.unstubAllEnvs()
    for (const name of ['DO_NOT_TRACK', 'DOBIUS_TELEMETRY_DISABLED', 'CI', 'GITHUB_ACTIONS']) {
      vi.stubEnv(name, '')
    }
  })

  it('reports transport_unavailable for an opted-in user when the build cannot send', () => {
    transportAvailableMock.mockReturnValue(false)
    expect(getConsentState(true)).toEqual({
      effective: 'disabled',
      reason: 'transport_unavailable'
    })
  })

  it('reports transport_unavailable ahead of an env kill switch', () => {
    transportAvailableMock.mockReturnValue(false)
    vi.stubEnv('DO_NOT_TRACK', '1')
    expect(getConsentState(false)).toEqual({
      effective: 'disabled',
      reason: 'transport_unavailable'
    })
  })

  it('falls through to the stored preference when the build can send', () => {
    transportAvailableMock.mockReturnValue(true)
    expect(getConsentState(true)).toEqual({ effective: 'enabled' })
    expect(getConsentState(false)).toEqual({ effective: 'disabled', reason: 'user_opt_out' })
  })
})
