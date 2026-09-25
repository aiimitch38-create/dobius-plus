// #122 F11: the renderer's IPC shape check must let `transport_unavailable`
// through, or the Privacy pane falls back to a live-looking switch.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryConsentState } from '../../../shared/telemetry-consent-types'
import { getConsentState } from './telemetry'

function stubConsent(value: unknown): void {
  vi.stubGlobal('window', {
    api: { telemetryGetConsentState: vi.fn(async () => value) }
  })
}

describe('getConsentState()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes transport_unavailable through from main', async () => {
    const state: TelemetryConsentState = { effective: 'disabled', reason: 'transport_unavailable' }
    stubConsent(state)
    await expect(getConsentState()).resolves.toEqual(state)
  })

  it('still fails closed on an unknown reason', async () => {
    stubConsent({ effective: 'disabled', reason: 'something_else' })
    await expect(getConsentState()).resolves.toEqual({ effective: 'pending_banner' })
  })
})
