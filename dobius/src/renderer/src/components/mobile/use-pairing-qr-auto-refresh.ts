import { useEffect, useRef } from 'react'
import { MOBILE_PAIRING_QR_REFRESH_MS } from '../../../../shared/mobile-pairing-offer-lifetime'

// Why: an unscanned phone QR expires on the desktop; re-fetching on this
// interval keeps the QR on screen valid without the user pressing Regenerate.
export function startPairingQrRefresh(
  refresh: () => void,
  intervalMs = MOBILE_PAIRING_QR_REFRESH_MS
): () => void {
  const timer = setInterval(refresh, intervalMs)
  return () => clearInterval(timer)
}

export function usePairingQrAutoRefresh(active: boolean, refresh: () => void): void {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    if (!active) {
      return undefined
    }
    return startPairingQrRefresh(() => refreshRef.current())
  }, [active])
}
