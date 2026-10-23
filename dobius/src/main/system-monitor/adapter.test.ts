import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SystemMonitorStatus } from '../../shared/system-monitor'
import {
  evaluateSystemMonitorAdmission,
  loadSystemMonitorSnapshot,
  type SystemMonitorRegistration
} from './adapter'

const GIB = 1024 ** 3
const directories: string[] = []

function fixture() {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'dobius-system-monitor-'))
  directories.push(base)
  chmodSync(base, 0o700)
  const rootPath = join(base, 'project')
  mkdirSync(rootPath)
  const { dev, ino } = statSync(rootPath)
  const registration: SystemMonitorRegistration = {
    deviceId: 'laptop-1',
    roots: [{ id: 'project', path: rootPath, device: dev, inode: ino }],
    policy: {
      sampleSeconds: 60,
      freshnessSeconds: 180,
      warnBytes: 20 * GIB,
      warnFraction: 0.15,
      criticalBytes: 10 * GIB,
      criticalFraction: 0.08,
      hysteresisBytes: 2 * GIB,
      hysteresisFraction: 0.02,
      safetyMarginBytes: 5 * GIB,
      unknownEstimateBytes: 20 * GIB
    }
  }
  const status: SystemMonitorStatus = {
    schemaVersion: 1,
    deviceId: registration.deviceId,
    sampledAt: 1_000,
    freshnessSeconds: 180,
    health: 'healthy',
    roots: [
      {
        id: 'project',
        path: rootPath,
        identity: { device: dev, inode: ino },
        state: 'available',
        volumeId: String(dev),
        inventory: null
      }
    ],
    volumes: [
      {
        id: String(dev),
        totalBytes: 100 * GIB,
        freeBytes: 40 * GIB,
        usedBytes: 60 * GIB,
        state: 'healthy',
        thresholds: { warningBytes: 20 * GIB, criticalBytes: 10 * GIB, hysteresisBytes: 2 * GIB },
        history: [{ sampledAt: 1_000, freeBytes: 40 * GIB }],
        freeBytesPerSecond: null
      }
    ],
    alerts: [],
    cleanupReceipts: [],
    cleanupEnabled: false,
    publisher: 'private_local_file',
    platform: 'darwin',
    inventorySupported: true,
    topConsumers: []
  }
  return { base, rootPath, registration, status }
}

function save(base: string, status: unknown) {
  const path = join(base, 'status.json')
  writeFileSync(path, JSON.stringify(status), { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('system monitor main-process adapter', () => {
  it('maps Unix seconds to milliseconds and applies an exact freshness boundary', () => {
    const { base, registration, status } = fixture()
    save(base, status)

    const boundary = loadSystemMonitorSnapshot(base, registration, 1_180_000)
    expect(boundary).toMatchObject({
      availability: 'available',
      freshness: 'fresh',
      sampledAtMs: 1_000_000,
      ageMs: 180_000
    })
    expect(loadSystemMonitorSnapshot(base, registration, 1_181_000)).toMatchObject({
      availability: 'available',
      freshness: 'stale',
      ageMs: 181_000
    })
  })

  it('maps malformed, oversized, missing, and non-private snapshots to typed unavailable', () => {
    const { base, registration, status } = fixture()
    const path = save(base, status)
    rmSync(path)
    expect(loadSystemMonitorSnapshot(base, registration, 1_001_000)).toMatchObject({
      availability: 'unavailable',
      freshness: 'unavailable',
      reason: 'missing'
    })
    save(base, status)
    for (const malformed of [null, { ...status, roots: null }, { ...status, volumes: [null] }]) {
      save(base, malformed)
      expect(loadSystemMonitorSnapshot(base, registration, 1_001_000)).toMatchObject({
        availability: 'unavailable',
        health: 'unavailable',
        freshness: 'unavailable',
        reason: 'invalid'
      })
    }
    writeFileSync(path, ' '.repeat(2 * 1024 * 1024 + 1), { mode: 0o600 })
    chmodSync(path, 0o600)
    expect(loadSystemMonitorSnapshot(base, registration, 1_001_000)).toMatchObject({
      availability: 'unavailable',
      reason: 'invalid'
    })
    save(base, status)
    chmodSync(path, 0o644)
    expect(loadSystemMonitorSnapshot(base, registration, 1_001_000)).toMatchObject({
      availability: 'unavailable',
      reason: 'untrusted_file'
    })
  })

  it('rejects device, registered path, and mount identity changes', () => {
    const { base, registration, rootPath, status } = fixture()
    save(base, { ...status, deviceId: 'other-device' })
    expect(loadSystemMonitorSnapshot(base, registration, 1_001_000)).toMatchObject({
      availability: 'unavailable',
      reason: 'identity_mismatch'
    })
    save(base, {
      ...status,
      roots: [{ ...status.roots[0], path: `${rootPath}/redirected` }]
    })
    expect(loadSystemMonitorSnapshot(base, registration, 1_001_000)).toMatchObject({
      availability: 'unavailable',
      reason: 'identity_mismatch'
    })
    save(base, {
      ...status,
      roots: [{ ...status.roots[0], identity: { ...status.roots[0].identity, inode: 99 } }]
    })
    expect(loadSystemMonitorSnapshot(base, registration, 1_001_000)).toMatchObject({
      availability: 'unavailable',
      reason: 'identity_mismatch'
    })
    renameSync(rootPath, `${rootPath}-old`)
    mkdirSync(rootPath)
    save(base, status)
    expect(loadSystemMonitorSnapshot(base, registration, 1_001_000)).toMatchObject({
      availability: 'unavailable',
      reason: 'identity_mismatch'
    })
  })

  it('rejects path-like IDs and invalid root-to-volume references', () => {
    const { base, registration, status } = fixture()
    const root = status.roots[0]
    const volume = status.volumes[0]
    const candidates: unknown[] = [
      { ...status, deviceId: '/Users/private/device' },
      { ...status, roots: [{ ...root, id: '/Users/private/root' }] },
      { ...status, volumes: [{ ...volume, id: '/Volumes/private' }] },
      { ...status, roots: [{ ...root, volumeId: null }] },
      { ...status, roots: [{ ...root, volumeId: '/Volumes/private' }] },
      { ...status, roots: [{ ...root, state: 'unavailable' as const }] },
      {
        ...status,
        volumes: [...status.volumes, { ...volume, id: String(root.identity.device + 1) }]
      },
      {
        ...status,
        roots: [{ ...root, volumeId: String(root.identity.device + 1) }],
        volumes: [{ ...volume, id: String(root.identity.device + 1) }]
      },
      {
        ...status,
        roots: [{ ...root, volumeId: `0${volume.id}` }],
        volumes: [{ ...volume, id: `0${volume.id}` }]
      }
    ]

    for (const candidate of candidates) {
      save(base, candidate)
      expect(loadSystemMonitorSnapshot(base, registration, 1_001_000)).toMatchObject({
        availability: 'unavailable',
        reason: 'invalid'
      })
    }
  })

  it('fails closed on clock skew and retains producer critical hysteresis', () => {
    const { base, registration, status } = fixture()
    save(base, { ...status, sampledAt: 1_006 })
    const skewed = loadSystemMonitorSnapshot(base, registration, 1_000_000)
    expect(skewed).toMatchObject({ availability: 'unavailable', freshness: 'clock_skew' })
    expect(
      evaluateSystemMonitorAdmission(skewed, registration, {
        rootId: 'project',
        estimateBytes: 0,
        reservedBytes: 0
      }).reason
    ).toBe('clock_skew')

    save(base, {
      ...status,
      health: 'critical',
      volumes: [{ ...status.volumes[0], freeBytes: 30 * GIB, state: 'critical' }]
    })
    const critical = loadSystemMonitorSnapshot(base, registration, 1_001_000)
    expect(critical).toMatchObject({ availability: 'available', health: 'critical' })
    expect(
      evaluateSystemMonitorAdmission(critical, registration, {
        rootId: 'project',
        estimateBytes: 0,
        reservedBytes: 0
      })
    ).toMatchObject({ allowed: false, reason: 'insufficient_space' })
  })

  it('uses the conservative unknown estimate and caller-owned reservation total without reserving', () => {
    const { base, registration, status } = fixture()
    save(base, status)
    const snapshot = loadSystemMonitorSnapshot(base, registration, 1_001_000)
    expect(snapshot.availability).toBe('available')
    if (snapshot.availability !== 'available') {
      return
    }

    expect(
      evaluateSystemMonitorAdmission(snapshot, registration, {
        rootId: 'project',
        estimateBytes: null,
        reservedBytes: 0
      })
    ).toMatchObject({
      allowed: true,
      estimateSource: 'unknown_policy',
      estimatedWorkingBytes: 20 * GIB
    })
    expect(
      evaluateSystemMonitorAdmission(snapshot, registration, {
        rootId: 'project',
        estimateBytes: null,
        reservedBytes: 6 * GIB
      })
    ).toMatchObject({ allowed: false, reason: 'insufficient_space' })
    expect(
      evaluateSystemMonitorAdmission(snapshot, registration, {
        rootId: 'project',
        estimateBytes: null,
        reservedBytes: -1
      })
    ).toMatchObject({ allowed: false, reason: 'invalid_space_estimate' })
  })
})
