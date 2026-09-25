// Why: per-device tokens replace the shared runtime auth token for WebSocket
// (mobile) connections. Each paired device gets its own revocable token so
// compromising one device doesn't expose others. The registry is a simple
// JSON file with hardened permissions matching the runtime metadata pattern.
import { randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { hardenExistingSecureFile, writeSecureJsonFile } from '../../shared/secure-file'
import type { DeviceScope } from '../../shared/runtime-types'
import {
  MOBILE_PAIRING_OFFER_MIN_REMAINING_MS,
  MOBILE_PAIRING_OFFER_TTL_MS,
  MOBILE_PAIRING_TOKEN_GRACE_MS
} from '../../shared/mobile-pairing-offer-lifetime'
import { constantTimeEqual } from '../lib/constant-time-equal'
import { readSafeJsonFile } from '../storage/safe-json-file'
import { DEVICE_REGISTRY_FILENAME } from './mobile-pairing-files'
import { isMobileRpcGrant, type MobileRpcGrant } from './mobile-rpc-grants'

export type { DeviceScope }

export {
  MOBILE_PAIRING_OFFER_MIN_REMAINING_MS,
  MOBILE_PAIRING_OFFER_TTL_MS,
  MOBILE_PAIRING_TOKEN_GRACE_MS
}

function isLivePairingToken(device: DeviceEntry, token: string, now: number): boolean {
  return (
    device.pairingToken !== undefined &&
    (device.pairingTokenExpiresAt ?? 0) > now &&
    constantTimeEqual(token, device.pairingToken)
  )
}

function isExpiredPairingOffer(device: DeviceEntry, now: number): boolean {
  return (
    device.scope === 'mobile' &&
    device.lastSeenAt === 0 &&
    now - device.pairedAt > MOBILE_PAIRING_OFFER_TTL_MS
  )
}

export type DeviceEntry = {
  deviceId: string
  name: string
  token: string
  scope: DeviceScope
  pairedAt: number
  lastSeenAt: number
  // Why: explicit per-device opt-in for the high-risk mobile methods (see
  // mobile-rpc-grants.ts). Missing means none granted. Read at startup only;
  // edit dobius-devices.json with the app closed or a later save overwrites it.
  grants?: MobileRpcGrant[]
  // Why: the consumed QR token and when its grace window ends (see
  // consumePairingOffer). Absent once the phone logs in with its own token.
  pairingToken?: string
  pairingTokenExpiresAt?: number
}

// Why: an unreadable registry still holds every paired device on disk. Any
// save from the empty in-memory list would erase them, so mutations are
// refused until the file reads cleanly again.
export class DeviceRegistryUnreadableError extends Error {
  constructor(
    readonly filePath: string,
    readonly detail: string
  ) {
    super(
      `Device registry at ${filePath} is unreadable (${detail}); pairing changes are blocked until it is fixed`
    )
    this.name = 'DeviceRegistryUnreadableError'
  }
}

function errorDetail(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code)
  }
  return error instanceof Error ? error.message : String(error)
}

function parseDevices(raw: unknown): DeviceEntry[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined
  }
  const entries: DeviceEntry[] = []
  for (const item of raw) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as DeviceEntry).deviceId !== 'string' ||
      typeof (item as DeviceEntry).token !== 'string'
    ) {
      return undefined
    }
    const {
      grants: rawGrants,
      pairingToken,
      pairingTokenExpiresAt,
      ...device
    } = item as DeviceEntry & {
      grants?: unknown
      pairingToken?: unknown
      pairingTokenExpiresAt?: unknown
    }
    // Why: unknown or malformed grant values never authorize anything.
    const grants = Array.isArray(rawGrants) ? rawGrants.filter(isMobileRpcGrant) : []
    const hasPairingGrace =
      typeof pairingToken === 'string' && typeof pairingTokenExpiresAt === 'number'
    entries.push({
      ...device,
      ...(hasPairingGrace ? { pairingToken, pairingTokenExpiresAt } : {}),
      // Why: older registries only existed for phone pairing. Treat missing
      // scope as mobile so legacy device tokens do not gain new CLI powers.
      scope: device.scope === 'runtime' ? 'runtime' : 'mobile',
      ...(grants.length > 0 ? { grants } : {})
    })
  }
  return entries
}

export class DeviceRegistry {
  private readonly registryPath: string
  private devices: DeviceEntry[] = []
  // Non-null while the file on disk exists but could not be read.
  private unreadableDetail: string | null = null

  constructor(userDataPath: string) {
    this.registryPath = join(userDataPath, DEVICE_REGISTRY_FILENAME)
    this.load()
  }

  addDevice(name: string, scope: DeviceScope = 'mobile'): DeviceEntry {
    this.assertWritable()
    const entry: DeviceEntry = {
      deviceId: randomUUID(),
      name,
      token: randomBytes(24).toString('hex'),
      scope,
      pairedAt: Date.now(),
      lastSeenAt: 0
    }
    this.devices.push(entry)
    this.save()
    return entry
  }

  // Why: coalesce repeated QR-regenerate clicks onto a single pending token.
  // Each call to addDevice() produces a valid auth credential; without
  // coalescing, every renderer call to mobile:getPairingQR (e.g. the new
  // copy-button flow that encourages regeneration) leaves an orphaned token
  // forever. Returns an existing never-scanned entry if present; otherwise
  // mints a new one and drops any stale pending entries.
  getOrCreatePendingDevice(name: string, scope: DeviceScope = 'mobile'): DeviceEntry {
    this.assertWritable()
    const now = Date.now()
    const existing = this.devices.find((d) => d.lastSeenAt === 0 && d.scope === scope)
    if (existing && !isExpiredPairingOffer(existing, now + MOBILE_PAIRING_OFFER_MIN_REMAINING_MS)) {
      return existing
    }
    if (existing) {
      // Why: never hand out an expired or nearly expired offer; mint a fresh one.
      return this.rotatePendingDevice(name, scope)
    }
    return this.addDevice(name, scope)
  }

  // Why: explicit rotation path for "Regenerate QR" — invalidates any
  // existing never-scanned token (e.g. one that was screenshotted, copied
  // to clipboard, or shown on a screen-share) and mints a fresh one. Without
  // this, getOrCreatePendingDevice keeps returning the same token forever
  // until a phone actually pairs, so users have no way to revoke a leaked
  // pre-pairing token.
  rotatePendingDevice(name: string, scope: DeviceScope = 'mobile'): DeviceEntry {
    this.assertWritable()
    this.devices = this.devices.filter((d) => d.lastSeenAt !== 0 || d.scope !== scope)
    return this.addDevice(name, scope)
  }

  removeDevice(deviceId: string): boolean {
    this.assertWritable()
    const before = this.devices.length
    this.devices = this.devices.filter((d) => d.deviceId !== deviceId)
    if (this.devices.length < before) {
      this.save()
      return true
    }
    return false
  }

  getDevice(deviceId: string): DeviceEntry | null {
    this.reloadIfUnreadable()
    return this.devices.find((d) => d.deviceId === deviceId) ?? null
  }

  listDevices(): readonly DeviceEntry[] {
    this.reloadIfUnreadable()
    return this.devices
  }

  validateToken(token: string): DeviceEntry | null {
    this.reloadIfUnreadable()
    const now = Date.now()
    const device =
      this.devices.find(
        (d) => constantTimeEqual(token, d.token) || isLivePairingToken(d, token, now)
      ) ?? null
    if (device && isExpiredPairingOffer(device, now)) {
      return null
    }
    return device
  }

  // Why: a mobile pairing QR is single-use. Called on every successful phone
  // login: the first login with the QR swaps in a new token that only the
  // phone receives (inside the E2EE channel). The QR token then keeps working
  // for MOBILE_PAIRING_TOKEN_GRACE_MS, each use minting yet another token,
  // so a phone that failed to save its token can rescan; the first login
  // with the phone's own token (a later connection) retires the QR token at
  // once. Runtime links are shared by parallel short-lived sockets (CLI,
  // desktop remote hosts, browser tabs) and keep their token; they stay
  // listed and revocable instead. Throws if a swap cannot be saved (nothing
  // changes).
  consumePairingOffer(token: string): string | null {
    const device = this.validateToken(token)
    if (!device || device.scope !== 'mobile') {
      return null
    }
    const now = Date.now()
    const firstUse = device.lastSeenAt === 0
    if (!firstUse && !isLivePairingToken(device, token, now)) {
      if (device.pairingToken !== undefined) {
        this.retirePairingToken(device)
      }
      return null
    }
    this.assertWritable()
    const previous = { ...device }
    if (firstUse) {
      device.pairingToken = token
      device.pairingTokenExpiresAt = now + MOBILE_PAIRING_TOKEN_GRACE_MS
    }
    device.token = randomBytes(24).toString('hex')
    device.lastSeenAt = now
    try {
      this.save()
    } catch (error) {
      Object.assign(device, previous)
      if (firstUse) {
        delete device.pairingToken
        delete device.pairingTokenExpiresAt
      }
      throw error
    }
    return device.token
  }

  private retirePairingToken(device: DeviceEntry): void {
    const { pairingToken, pairingTokenExpiresAt } = device
    delete device.pairingToken
    delete device.pairingTokenExpiresAt
    try {
      this.save()
    } catch (error) {
      // Why: keep memory and disk in step; the grace window still ends on time.
      device.pairingToken = pairingToken
      device.pairingTokenExpiresAt = pairingTokenExpiresAt
      console.warn('[mobile] could not retire used pairing token:', error)
    }
  }

  updateLastSeen(deviceId: string): void {
    this.reloadIfUnreadable()
    if (this.unreadableDetail !== null) {
      return
    }
    const device = this.devices.find((d) => d.deviceId === deviceId)
    if (device) {
      device.lastSeenAt = Date.now()
      this.save()
    }
  }

  private assertWritable(): void {
    this.reloadIfUnreadable()
    if (this.unreadableDetail !== null) {
      throw new DeviceRegistryUnreadableError(this.registryPath, this.unreadableDetail)
    }
  }

  // Why: re-read while broken so a repaired file recovers without a restart.
  private reloadIfUnreadable(): void {
    if (this.unreadableDetail !== null) {
      this.load()
    }
  }

  private load(): void {
    try {
      hardenExistingSecureFile(this.registryPath)
    } catch (error) {
      this.markUnreadable(errorDetail(error))
      return
    }
    const result = readSafeJsonFile(this.registryPath, parseDevices, () => [])
    if (result.status === 'unreadable') {
      this.markUnreadable(result.detail ?? 'unreadable')
      return
    }
    if (this.unreadableDetail !== null) {
      console.warn(`[mobile] device registry ${this.registryPath} is readable again`)
    }
    this.unreadableDetail = null
    this.devices = result.value
  }

  private markUnreadable(detail: string): void {
    if (this.unreadableDetail !== detail) {
      console.error(
        `[mobile] device registry ${this.registryPath} unreadable (${detail}); pairing changes are blocked until it is fixed`
      )
    }
    this.unreadableDetail = detail
    // Why: no token may authenticate against a registry we cannot read.
    this.devices = []
  }

  private save(): void {
    writeSecureJsonFile(this.registryPath, this.devices)
  }
}
