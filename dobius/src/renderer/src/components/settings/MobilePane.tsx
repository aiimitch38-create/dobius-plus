import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '../../store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useMobilePairingDevicePolling } from './mobile-pairing-device-polling'
import { usePairingQrAutoRefresh } from '../mobile/use-pairing-qr-auto-refresh'
import {
  selectRefreshedNetworkAddress,
  type MobileNetworkInterface
} from './mobile-network-interface-selection'
import { MobileNetworkInterfaceSection } from './MobileNetworkInterfaceSection'
import { MobilePairingQrSection } from './MobilePairingQrSection'
import { MobilePairedDevicesSection, type PairedDevice } from './MobilePairedDevicesSection'
import { MobileAutoRestoreFitSection } from './MobileAutoRestoreFitSection'
import { translate } from '@/i18n/i18n'
export { getMobilePaneSearchEntries } from './mobile-pane-search'

type ListenerStatus = { ready: boolean; startedWithListenerEnabled: boolean }

function isListenerOffAtLaunch(status: ListenerStatus | null): boolean {
  return status !== null && !status.ready && !status.startedWithListenerEnabled
}

export function MobilePane(): React.JSX.Element {
  const autoRestoreFitMs = useAppStore((s) => s.settings?.mobileAutoRestoreFitMs ?? null)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const mobileListenerEnabled = useAppStore((s) => s.settings?.mobileListenerEnabled === true)
  // Why: null until checked. startedWithListenerEnabled separates "off at
  // launch" (explain it, no error toast) from "on at launch but failed to
  // start" (a real error, e.g. port in use).
  const [listenerStatus, setListenerStatus] = useState<ListenerStatus | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [pairingUrl, setPairingUrl] = useState<string | null>(null)
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [devices, setDevices] = useState<PairedDevice[]>([])
  const [qrEnlarged, setQrEnlarged] = useState(false)
  const [networkInterfaces, setNetworkInterfaces] = useState<MobileNetworkInterface[]>([])
  const [selectedAddress, setSelectedAddress] = useState<string | undefined>(undefined)
  const [refreshingNetworkInterfaces, setRefreshingNetworkInterfaces] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [deviceCountAtQr, setDeviceCountAtQr] = useState<number | null>(null)
  const devicesRef = useRef<PairedDevice[]>([])
  const codeCopiedResetTimerRef = useRef<number | null>(null)
  const mountedRef = useMountedRef()

  const clearCodeCopiedResetTimer = useCallback((): void => {
    if (codeCopiedResetTimerRef.current !== null) {
      window.clearTimeout(codeCopiedResetTimerRef.current)
      codeCopiedResetTimerRef.current = null
    }
  }, [])

  const loadDevices = useCallback(async () => {
    try {
      const result = await window.api.mobile.listDevices()
      if (mountedRef.current) {
        devicesRef.current = result.devices
        setDevices(result.devices)
      }
    } catch {
      // Silently fail — device list is non-critical
    }
  }, [mountedRef])

  const loadListenerStatus = useCallback(async (): Promise<ListenerStatus | null> => {
    try {
      const result = await window.api.mobile.isWebSocketReady()
      const status: ListenerStatus = {
        ready: result.ready,
        startedWithListenerEnabled: result.startedWithListenerEnabled
      }
      if (mountedRef.current) {
        setListenerStatus(status)
      }
      return status
    } catch {
      // Unknown status: callers fall back to the generic error message.
      return null
    }
  }, [mountedRef])

  const loadNetworkInterfaces = useCallback(
    async (opts: { notifyOnError?: boolean } = {}) => {
      setRefreshingNetworkInterfaces(true)
      try {
        const result = await window.api.mobile.listNetworkInterfaces()
        if (mountedRef.current) {
          setNetworkInterfaces(result.interfaces)
          setSelectedAddress((currentAddress) =>
            selectRefreshedNetworkAddress(currentAddress, result.interfaces)
          )
        }
      } catch {
        if (opts.notifyOnError && mountedRef.current) {
          toast.error(
            translate(
              'auto.components.settings.MobilePane.d714614dbf',
              'Failed to refresh network interfaces'
            )
          )
        }
      } finally {
        if (mountedRef.current) {
          setRefreshingNetworkInterfaces(false)
        }
      }
    },
    [mountedRef]
  )

  const generateQR = useCallback(
    async (opts: { rotate?: boolean } = {}) => {
      setLoading(true)
      try {
        const result = await window.api.mobile.getPairingQR({
          ...(selectedAddress ? { address: selectedAddress } : {}),
          ...(opts.rotate ? { rotate: true } : {})
        })
        if (result.available) {
          useAppStore.getState().recordFeatureInteraction('mobile-pairing')
          if (mountedRef.current) {
            setQrDataUrl(result.qrDataUrl)
            setPairingUrl(result.pairingUrl)
            setEndpoint(result.endpoint)
            setDeviceCountAtQr(devicesRef.current.length)
            clearCodeCopiedResetTimer()
            setCodeCopied(false)
            void loadDevices()
          }
        } else {
          // Why: when the listener was off at launch, the inline notice
          // explains why pairing is unavailable; a raw error toast would not.
          const status = await loadListenerStatus()
          if (!isListenerOffAtLaunch(status) && mountedRef.current) {
            toast.error(
              translate(
                'auto.components.settings.MobilePane.cb9067c1c1',
                'WebSocket transport is not running'
              )
            )
          }
        }
      } catch {
        if (mountedRef.current) {
          toast.error(
            translate(
              'auto.components.settings.MobilePane.e3c427e020',
              'Failed to generate QR code'
            )
          )
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false)
        }
      }
    },
    [clearCodeCopiedResetTimer, loadDevices, loadListenerStatus, mountedRef, selectedAddress]
  )

  useEffect(() => {
    void loadDevices()
    void loadNetworkInterfaces()
    void loadListenerStatus()
  }, [loadDevices, loadListenerStatus, loadNetworkInterfaces])

  // Why: keep the shown QR inside its 15 min lifetime while this pane is open.
  usePairingQrAutoRefresh(qrDataUrl != null, () => void generateQR())

  useMobilePairingDevicePolling({
    deviceCountAtQr,
    currentDeviceCount: devices.length,
    loadDevices
  })

  async function revokeDevice(deviceId: string) {
    try {
      await window.api.mobile.revokeDevice({ deviceId })
      if (mountedRef.current) {
        setDevices((prev) => {
          const nextDevices = prev.filter((d) => d.deviceId !== deviceId)
          devicesRef.current = nextDevices
          return nextDevices
        })
        toast.success(translate('auto.components.settings.MobilePane.2e3dd0bc29', 'Device revoked'))
      }
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate('auto.components.settings.MobilePane.870e1b5ca5', 'Failed to revoke device')
        )
      }
    }
  }

  return (
    <div className="space-y-6">
      {listenerStatus && !listenerStatus.ready ? (
        <p
          role="status"
          className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          {listenerStatus.startedWithListenerEnabled
            ? translate(
                'auto.components.settings.MobilePane.listenerFailedToStart',
                'The phone listener was on at launch but failed to start (see logs). Restart Dobius+ to try again.'
              )
            : mobileListenerEnabled
              ? translate(
                  'auto.components.settings.MobilePane.listenerPendingRestart',
                  'The phone listener is turned on but only starts the next time Dobius+ launches. Restart Dobius+ to pair a phone.'
                )
              : translate(
                  'auto.components.settings.MobilePane.listenerOff',
                  'The phone listener is off, so phones cannot pair or connect. Turn on Phone Listener above, then restart Dobius+.'
                )}
        </p>
      ) : null}

      <MobileNetworkInterfaceSection
        networkInterfaces={networkInterfaces}
        selectedAddress={selectedAddress}
        onSelectedAddressChange={setSelectedAddress}
        refreshingNetworkInterfaces={refreshingNetworkInterfaces}
        onRefreshNetworkInterfaces={() => void loadNetworkInterfaces({ notifyOnError: true })}
        loading={loading}
        hasQrCode={qrDataUrl != null}
        onGenerateQr={() => void generateQR({ rotate: qrDataUrl != null })}
      />

      <MobilePairingQrSection
        qrDataUrl={qrDataUrl}
        pairingUrl={pairingUrl}
        endpoint={endpoint}
        qrEnlarged={qrEnlarged}
        codeCopied={codeCopied}
        onQrEnlargedChange={setQrEnlarged}
        onCodeCopiedChange={setCodeCopied}
        onClearCodeCopiedTimer={clearCodeCopiedResetTimer}
      />

      <MobilePairedDevicesSection
        devices={devices}
        hasQrCode={qrDataUrl != null}
        onRevokeDevice={(deviceId) => void revokeDevice(deviceId)}
      />

      <MobileAutoRestoreFitSection
        autoRestoreFitMs={autoRestoreFitMs}
        onAutoRestoreFitChange={(ms) => void updateSettings({ mobileAutoRestoreFitMs: ms })}
      />
    </div>
  )
}
