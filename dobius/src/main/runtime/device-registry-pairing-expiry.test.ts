import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DeviceRegistry,
  MOBILE_PAIRING_OFFER_MIN_REMAINING_MS,
  MOBILE_PAIRING_OFFER_TTL_MS
} from './device-registry'
import { DEVICE_REGISTRY_FILENAME } from './mobile-pairing-files'

// Why: #19 — a pairing QR is a full device token. An old screenshot of an
// unscanned QR must stop working; a phone that already paired must not.

const T0 = Date.UTC(2026, 8, 25, 12, 0, 0)
let dir = ''

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  dir = mkdtempSync(join(tmpdir(), 'dobius-pairing-expiry-'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('mobile pairing offer expiry (#19)', () => {
  it('accepts an unscanned QR token inside the TTL', () => {
    const registry = new DeviceRegistry(dir)
    const offer = registry.getOrCreatePendingDevice('Mobile', 'mobile')
    vi.setSystemTime(T0 + MOBILE_PAIRING_OFFER_TTL_MS - 1)
    expect(registry.validateToken(offer.token)?.deviceId).toBe(offer.deviceId)
  })

  it('rejects an unscanned QR token after the TTL, also after a restart', () => {
    const registry = new DeviceRegistry(dir)
    const offer = registry.getOrCreatePendingDevice('Mobile', 'mobile')
    vi.setSystemTime(T0 + MOBILE_PAIRING_OFFER_TTL_MS + 1)
    expect(registry.validateToken(offer.token)).toBeNull()
    expect(new DeviceRegistry(dir).validateToken(offer.token)).toBeNull()
  })

  it('never re-issues an expired offer when a new QR is requested', () => {
    const registry = new DeviceRegistry(dir)
    const stale = registry.getOrCreatePendingDevice('Mobile', 'mobile')
    vi.setSystemTime(T0 + MOBILE_PAIRING_OFFER_TTL_MS + 1)
    const fresh = registry.getOrCreatePendingDevice('Mobile', 'mobile')

    expect(fresh.token).not.toBe(stale.token)
    expect(registry.validateToken(fresh.token)?.deviceId).toBe(fresh.deviceId)
    expect(registry.getDevice(stale.deviceId)).toBeNull()
  })

  it('re-issues an offer with more than 5 minutes left, mints a new one below that (F2)', () => {
    const registry = new DeviceRegistry(dir)
    const offer = registry.getOrCreatePendingDevice('Mobile', 'mobile')
    const edge = MOBILE_PAIRING_OFFER_TTL_MS - MOBILE_PAIRING_OFFER_MIN_REMAINING_MS
    vi.setSystemTime(T0 + edge)
    expect(registry.getOrCreatePendingDevice('Mobile', 'mobile').token).toBe(offer.token)
    vi.setSystemTime(T0 + edge + 1)
    const fresh = registry.getOrCreatePendingDevice('Mobile', 'mobile')
    expect(fresh.token).not.toBe(offer.token)
    expect(registry.getDevice(offer.deviceId)).toBeNull()
  })

  it('keeps a paired phone valid long after the TTL', () => {
    const registry = new DeviceRegistry(dir)
    const offer = registry.getOrCreatePendingDevice('Mobile', 'mobile')
    registry.updateLastSeen(offer.deviceId)
    vi.setSystemTime(T0 + 30 * 24 * 60 * 60 * 1000)
    expect(registry.validateToken(offer.token)?.deviceId).toBe(offer.deviceId)
  })

  it('does not expire runtime links, which stay listed and revocable', () => {
    const registry = new DeviceRegistry(dir)
    const link = registry.getOrCreatePendingDevice('Runtime', 'runtime')
    vi.setSystemTime(T0 + MOBILE_PAIRING_OFFER_TTL_MS * 10)
    expect(registry.validateToken(link.token)?.deviceId).toBe(link.deviceId)
  })

  it('expires a legacy on-disk pending mobile entry by its pairedAt', () => {
    writeFileSync(
      join(dir, DEVICE_REGISTRY_FILENAME),
      JSON.stringify([
        {
          deviceId: 'old-qr',
          name: 'Mobile',
          token: 'screenshotted-token',
          scope: 'mobile',
          pairedAt: T0 - 90 * 24 * 60 * 60 * 1000,
          lastSeenAt: 0
        }
      ])
    )
    expect(new DeviceRegistry(dir).validateToken('screenshotted-token')).toBeNull()
  })
})

describe('DeviceRegistry.validateToken compares in constant time (#22)', () => {
  it('rejects wrong-length, empty and prefix tokens without throwing', () => {
    const registry = new DeviceRegistry(dir)
    const device = registry.addDevice('Phone', 'mobile')
    expect(registry.validateToken(device.token)?.deviceId).toBe(device.deviceId)
    expect(registry.validateToken('')).toBeNull()
    expect(registry.validateToken(device.token.slice(0, 10))).toBeNull()
    expect(registry.validateToken(`${device.token}x`)).toBeNull()
  })
})
