// Why: a phone pairing QR carries a full device token. Until a phone first
// connects, the only copy is on screen (or in a screenshot), so an unscanned
// mobile offer stops authenticating after this long. Runtime links are listed
// and revocable in Settings, so they keep no TTL.
export const MOBILE_PAIRING_OFFER_TTL_MS = 15 * 60 * 1000

// Why: a QR fetched with less than this left could expire while the phone is
// still scanning it, so the desktop mints a fresh offer instead of reusing it.
export const MOBILE_PAIRING_OFFER_MIN_REMAINING_MS = 5 * 60 * 1000

// Why: the pairing screens re-fetch on this interval, so the QR on screen is
// at most (TTL - MIN_REMAINING) + this old, i.e. 14 min: always still valid.
export const MOBILE_PAIRING_QR_REFRESH_MS = 4 * 60 * 1000
