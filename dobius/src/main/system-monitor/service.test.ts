import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MonitorResponseSchema } from '../../shared/monitor-view-schema'
import type { SystemMonitorConfig, SystemMonitorStatus } from '../../shared/system-monitor'
import { SystemMonitorService } from './service'

const GIB = 1024 ** 3
const directories: string[] = []

function fixture() {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'dobius-system-monitor-service-'))
  directories.push(base)
  chmodSync(base, 0o700)
  const rootPath = join(base, 'project')
  mkdirSync(rootPath)
  const { dev, ino } = statSync(rootPath)
  const config: SystemMonitorConfig = {
    schemaVersion: 1,
    deviceId: 'garry-laptop',
    roots: [{ id: 'dobius', path: rootPath, device: dev, inode: ino }],
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
    },
    scan: {
      maxEntriesPerTick: 2500,
      maxSecondsPerTick: 0.1,
      maxDirectories: 10_000,
      maxInodes: 50_000,
      maxDepth: 64,
      refreshSeconds: 900
    }
  }
  const status: SystemMonitorStatus = {
    schemaVersion: 1,
    deviceId: config.deviceId,
    sampledAt: 1_000,
    freshnessSeconds: config.policy.freshnessSeconds,
    health: 'healthy',
    roots: [
      {
        id: 'dobius',
        path: rootPath,
        identity: { device: dev, inode: ino },
        state: 'available',
        volumeId: String(dev),
        inventory: {
          generation: 'fixture-generation',
          state: 'complete',
          startedAt: 900,
          finishedAt: 999,
          logicalBytes: 1234,
          allocatedBytes: 2048,
          files: 3,
          directories: 1,
          pendingDirectories: 0,
          skipped: { symlinks: 0, mounts: 0, specialFiles: 0, hardlinks: 0 },
          errorCount: 0,
          errors: [],
          limitReached: false,
          reclaimableBytes: null,
          consistency: 'live_observation'
        }
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
    topConsumers: [
      { rootId: 'dobius', logicalBytes: 1234, allocatedBytes: 2048, state: 'complete' }
    ]
  }
  return { base, rootPath, config, status }
}

function save(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

function writeFixture(base: string, config: unknown, status: unknown): void {
  save(join(base, 'config.json'), config)
  save(join(base, 'status.json'), status)
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform === 'win32')('SystemMonitorService', () => {
  it('projects a path-redacted view and recomputes freshness on every read', () => {
    const { base, rootPath, config, status } = fixture()
    writeFixture(base, config, status)
    let now = 1_180_000
    const service = new SystemMonitorService(base, () => now)

    expect(service.status()).toEqual({
      availability: 'available',
      deviceId: 'garry-laptop',
      health: 'healthy',
      freshness: 'fresh',
      reason: null,
      source: 'private_local_file',
      sampledAtMs: 1_000_000,
      ageMs: 180_000,
      freshnessSeconds: 180,
      volumes: [
        {
          id: String(status.volumes[0].id),
          totalBytes: 100 * GIB,
          freeBytes: 40 * GIB,
          usedBytes: 60 * GIB,
          state: 'healthy'
        }
      ],
      roots: [
        {
          id: 'dobius',
          state: 'available',
          logicalBytes: 1234,
          allocatedBytes: 2048,
          inventoryState: 'complete'
        }
      ],
      cleanupEnabled: false
    })
    expect(JSON.stringify(service.status())).not.toContain(rootPath)
    expect(JSON.stringify(service.status())).not.toContain(base)

    now = 1_181_000
    expect(service.status()).toMatchObject({ freshness: 'stale', ageMs: 181_000 })
  })

  it('returns the validated freshness TTL and preserves fractional locally computed age', () => {
    const { base, config, status } = fixture()
    writeFixture(base, config, status)
    const service = new SystemMonitorService(base, () => 1_179_999.75)

    const projected = service.status()
    expect(projected).toMatchObject({
      freshness: 'fresh',
      sampledAtMs: 1_000_000,
      ageMs: 179_999.75,
      freshnessSeconds: 180
    })
    expect(MonitorResponseSchema.parse({ configured: true, status: projected }).status?.ageMs).toBe(
      179_999.75
    )
    expect(new SystemMonitorService(base, () => 1_180_000.25).status().freshness).toBe('stale')
  })

  it('clamps an adapter-accepted future sample to a nonnegative public age', () => {
    const { base, config, status } = fixture()
    writeFixture(base, config, status)
    const view = new SystemMonitorService(base, () => 996_000).status()

    expect(view).toMatchObject({
      availability: 'available',
      freshness: 'fresh',
      sampledAtMs: 1_000_000,
      ageMs: 0,
      freshnessSeconds: 180
    })
    expect(MonitorResponseSchema.parse({ configured: true, status: view }).status?.ageMs).toBe(0)
  })

  it('fails closed for missing, malformed, unsupported, or mismatched registration', () => {
    const { base, config, status } = fixture()
    const service = new SystemMonitorService(base, () => 1_001_000)
    expect(service.status()).toMatchObject({
      availability: 'unavailable',
      reason: 'missing_config'
    })
    expect(service.status().freshnessSeconds).toBeNull()

    writeFixture(base, { ...config, schemaVersion: 2 }, status)
    expect(service.status()).toMatchObject({
      availability: 'unavailable',
      reason: 'invalid_config'
    })
    writeFixture(base, { ...config, roots: null }, status)
    expect(service.status()).toMatchObject({
      availability: 'unavailable',
      reason: 'invalid_config'
    })
    writeFixture(base, { ...config, roots: [config.roots[0], config.roots[0]] }, status)
    expect(service.status()).toMatchObject({
      availability: 'unavailable',
      reason: 'invalid_config'
    })

    save(join(base, 'config.json'), config)
    rmSync(join(base, 'status.json'))
    expect(service.status()).toMatchObject({
      availability: 'unavailable',
      deviceId: config.deviceId,
      reason: 'missing_snapshot'
    })
    save(join(base, 'status.json'), { ...status, roots: null })
    expect(service.status()).toMatchObject({
      availability: 'unavailable',
      deviceId: config.deviceId,
      reason: 'invalid_snapshot'
    })

    writeFixture(base, config, { ...status, deviceId: 'different-device' })
    expect(service.status()).toMatchObject({
      availability: 'unavailable',
      deviceId: config.deviceId,
      reason: 'identity_mismatch'
    })
  })

  it('never echoes path-like device or root IDs from an invalid registration', () => {
    const { base, config, status } = fixture()
    const service = new SystemMonitorService(base, () => 1_001_000)
    for (const unsafe of [
      { ...config, deviceId: '/Users/private/device' },
      { ...config, roots: [{ ...config.roots[0], id: '/Volumes/private/root' }] }
    ]) {
      writeFixture(base, unsafe, status)
      const view = service.status()
      expect(view).toMatchObject({
        availability: 'unavailable',
        deviceId: null,
        reason: 'invalid_config'
      })
      expect(JSON.stringify(view)).not.toMatch(/\/Users\/private|\/Volumes\/private/)
    }
  })

  it('never projects path-like IDs or invalid volume references from a snapshot', () => {
    const { base, config, status } = fixture()
    const root = status.roots[0]
    const volume = status.volumes[0]
    save(join(base, 'config.json'), config)
    const candidates = [
      { ...status, deviceId: '/Users/private/device' },
      { ...status, roots: [{ ...root, id: '/Users/private/root' }] },
      { ...status, volumes: [{ ...volume, id: '/Volumes/private/volume' }] },
      { ...status, roots: [{ ...root, volumeId: '/Volumes/private/volume' }] },
      { ...status, roots: [{ ...root, volumeId: null }] },
      { ...status, roots: [], volumes: [volume] }
    ]
    for (const candidate of candidates) {
      save(join(base, 'status.json'), candidate)
      const view = new SystemMonitorService(base, () => 1_001_000).status()
      expect(view).toMatchObject({ availability: 'unavailable', reason: 'invalid_snapshot' })
      expect(JSON.stringify(view)).not.toMatch(/\/Users\/private|\/Volumes\/private/)
    }
  })

  it('rejects symlink, FIFO, oversized, and non-private config files without exposing paths', () => {
    const { base, config, status } = fixture()
    const configPath = join(base, 'config.json')
    const targetPath = join(base, 'registered-config.json')
    writeFixture(base, config, status)
    rmSync(configPath)
    save(targetPath, config)
    symlinkSync(targetPath, configPath)
    expect(new SystemMonitorService(base).status()).toMatchObject({
      availability: 'unavailable',
      reason: 'untrusted_config'
    })

    rmSync(configPath)
    if (process.platform !== 'win32') {
      execFileSync('mkfifo', [configPath])
      expect(new SystemMonitorService(base).status()).toMatchObject({
        availability: 'unavailable',
        reason: 'untrusted_config'
      })
    }

    rmSync(configPath, { force: true })
    writeFileSync(configPath, ' '.repeat(2 * 1024 * 1024 + 1), { mode: 0o600 })
    chmodSync(configPath, 0o600)
    expect(new SystemMonitorService(base).status()).toMatchObject({
      availability: 'unavailable',
      reason: 'invalid_config'
    })

    save(configPath, config)
    if (process.platform !== 'win32') {
      chmodSync(configPath, 0o644)
      expect(new SystemMonitorService(base).status()).toMatchObject({
        availability: 'unavailable',
        reason: 'untrusted_config'
      })
    }
  })

  it('does not derive reclaimable capacity from inventory estimates', () => {
    const { base, config, status } = fixture()
    writeFixture(base, config, status)
    const view = new SystemMonitorService(base, () => 1_001_000).status()
    expect(view.availability).toBe('available')
    expect(JSON.stringify(view)).not.toContain('reclaimable')
    expect(view.cleanupEnabled).toBe(false)
  })
})
