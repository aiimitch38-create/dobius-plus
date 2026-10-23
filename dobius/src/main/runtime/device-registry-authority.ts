import type { DeviceEntry } from './device-registry'

export type DeviceRegistryAuthorityChange =
  | 'confirmed_mobile_eligibility'
  | 'device_revoked'
  | 'device_token_changed'
  | 'registry_reloaded'
  | 'registry_unreadable'

export type DeviceRegistryOptions = {
  onSecurityAuthorityChange?: (reason: DeviceRegistryAuthorityChange) => void
}

// Display names and positive last-seen timestamps are telemetry, not authority.
export function previewAuthorityFingerprint(devices: readonly DeviceEntry[]): string {
  return JSON.stringify(
    devices
      .filter((device) => device.scope === 'mobile' && device.lastSeenAt > 0)
      .map((device) => ({
        deviceId: device.deviceId,
        token: device.token,
        grants: [...(device.grants ?? [])].sort(),
        pairingToken: device.pairingToken ?? null,
        pairingTokenExpiresAt: device.pairingTokenExpiresAt ?? null
      }))
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId))
  )
}
