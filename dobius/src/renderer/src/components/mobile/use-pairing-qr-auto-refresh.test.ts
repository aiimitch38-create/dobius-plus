import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOBILE_PAIRING_QR_REFRESH_MS as PAIRING_QR_REFRESH_MS } from '../../../../shared/mobile-pairing-offer-lifetime'
import { startPairingQrRefresh } from './use-pairing-qr-auto-refresh'

describe('pairing QR auto refresh (F2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls refresh on every interval until stopped', () => {
    const refresh = vi.fn()
    const stop = startPairingQrRefresh(refresh)
    vi.advanceTimersByTime(PAIRING_QR_REFRESH_MS * 3)
    expect(refresh).toHaveBeenCalledTimes(3)
    stop()
    vi.advanceTimersByTime(PAIRING_QR_REFRESH_MS * 3)
    expect(refresh).toHaveBeenCalledTimes(3)
  })
})
