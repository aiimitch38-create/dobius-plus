import { describe, expect, it } from 'vitest'
import {
  MOBILE_PAIRING_OFFER_MIN_REMAINING_MS,
  MOBILE_PAIRING_OFFER_TTL_MS,
  MOBILE_PAIRING_QR_REFRESH_MS
} from './mobile-pairing-offer-lifetime'

describe('mobile pairing offer lifetime (F2)', () => {
  it('refreshes the shown QR before the server lets it expire', () => {
    const worstCaseAge =
      MOBILE_PAIRING_OFFER_TTL_MS -
      MOBILE_PAIRING_OFFER_MIN_REMAINING_MS +
      MOBILE_PAIRING_QR_REFRESH_MS
    expect(worstCaseAge).toBeLessThan(MOBILE_PAIRING_OFFER_TTL_MS)
  })
})
