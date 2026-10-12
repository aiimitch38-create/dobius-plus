import type * as SecureFileModule from '../../shared/secure-file'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceRegistry, MOBILE_PAIRING_TOKEN_GRACE_MS } from './device-registry'

const saveHooks = vi.hoisted(() => ({ fail: false }))

vi.mock('../../shared/secure-file', async (importOriginal) => {
  const actual = await importOriginal<typeof SecureFileModule>()
  return {
    ...actual,
    writeSecureJsonFile: ((...args: Parameters<typeof actual.writeSecureJsonFile>) => {
      if (saveHooks.fail) {
        throw Object.assign(new Error('EACCES: injected'), { code: 'EACCES' })
      }
      return actual.writeSecureJsonFile(...args)
    }) as typeof actual.writeSecureJsonFile
  }
})

let dir = ''
beforeEach(() => {
  saveHooks.fail = false
  dir = mkdtempSync(join(tmpdir(), 'dobius-consume-'))
})

describe('DeviceRegistry.consumePairingOffer (F1, round 2 F3)', () => {
  it('swaps a pending mobile token and persists the swap', () => {
    const registry = new DeviceRegistry(dir)
    const offer = registry.getOrCreatePendingDevice('Mobile', 'mobile')
    const qrToken = offer.token

    const phoneToken = registry.consumePairingOffer(qrToken)

    expect(phoneToken).toMatch(/^[0-9a-f]{48}$/)
    const reloaded = new DeviceRegistry(dir)
    expect(reloaded.validateToken(phoneToken!)?.deviceId).toBe(offer.deviceId)
    expect(reloaded.getDevice(offer.deviceId)!.lastSeenAt).toBeGreaterThan(0)
  })

  it('lets the QR be rescanned in the grace window, each time with a new token', () => {
    const registry = new DeviceRegistry(dir)
    const qrToken = registry.getOrCreatePendingDevice('Mobile', 'mobile').token
    const lostToken = registry.consumePairingOffer(qrToken)!

    expect(new DeviceRegistry(dir).validateToken(qrToken)).not.toBeNull()
    // The phone failed to save lostToken and scans the same QR again.
    const phoneToken = registry.consumePairingOffer(qrToken)!

    expect(phoneToken).not.toBe(lostToken)
    expect(registry.validateToken(lostToken)).toBeNull()
    expect(registry.validateToken(phoneToken)).not.toBeNull()
  })

  it('retires the QR as soon as the phone logs in with its own token', () => {
    const registry = new DeviceRegistry(dir)
    const qrToken = registry.getOrCreatePendingDevice('Mobile', 'mobile').token
    const phoneToken = registry.consumePairingOffer(qrToken)!

    expect(registry.consumePairingOffer(phoneToken)).toBeNull()

    expect(registry.validateToken(qrToken)).toBeNull()
    expect(registry.consumePairingOffer(qrToken)).toBeNull()
    expect(new DeviceRegistry(dir).validateToken(qrToken)).toBeNull()
    expect(registry.validateToken(phoneToken)).not.toBeNull()
  })

  it('retires the QR after the grace window even if the phone never logs in again', () => {
    vi.useFakeTimers()
    try {
      const registry = new DeviceRegistry(dir)
      const qrToken = registry.getOrCreatePendingDevice('Mobile', 'mobile').token
      const phoneToken = registry.consumePairingOffer(qrToken)!
      vi.advanceTimersByTime(MOBILE_PAIRING_TOKEN_GRACE_MS - 1)
      expect(registry.validateToken(qrToken)).not.toBeNull()
      vi.advanceTimersByTime(2)
      expect(registry.validateToken(qrToken)).toBeNull()
      expect(registry.consumePairingOffer(qrToken)).toBeNull()
      expect(registry.validateToken(phoneToken)).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never swaps runtime link tokens', () => {
    const registry = new DeviceRegistry(dir)
    const link = registry.getOrCreatePendingDevice('Runtime', 'runtime')
    expect(registry.consumePairingOffer(link.token)).toBeNull()
    expect(registry.validateToken(link.token)?.deviceId).toBe(link.deviceId)
  })

  it('throws and changes nothing when the swap cannot be saved', () => {
    const registry = new DeviceRegistry(dir)
    const offer = registry.getOrCreatePendingDevice('Mobile', 'mobile')
    const qrToken = offer.token
    saveHooks.fail = true

    expect(() => registry.consumePairingOffer(qrToken)).toThrow(/EACCES/)
    expect(registry.validateToken(qrToken)?.deviceId).toBe(offer.deviceId)
    expect(registry.getDevice(offer.deviceId)!.lastSeenAt).toBe(0)
  })
})
