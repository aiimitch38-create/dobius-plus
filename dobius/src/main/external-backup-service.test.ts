import { describe, expect, it, vi } from 'vitest'
import {
  ExternalBackupService,
  backupFolderNameFor,
  buildRsyncArgs,
  isDestinationAvailable
} from './external-backup-service'

function makeService(
  overrides: Partial<ConstructorParameters<typeof ExternalBackupService>[0]> = {}
): {
  service: ExternalBackupService
  rsync: ReturnType<typeof vi.fn>
  onDriveMissing: ReturnType<typeof vi.fn>
} {
  const rsync = vi.fn(async () => {})
  const onDriveMissing = vi.fn()
  const service = new ExternalBackupService({
    getSettings: () => ({ enabled: true, destination: '/Volumes/Drive' }),
    listSources: () => [{ path: '/repos/alpha' }],
    onDriveMissing,
    exists: () => true,
    ensureDir: () => {},
    runRsync: rsync,
    logger: { warn: () => {}, debug: () => {} },
    ...overrides
  })
  return { service, rsync, onDriveMissing }
}

describe('isDestinationAvailable', () => {
  it('is false for an empty destination even if exists() is permissive', () => {
    expect(isDestinationAvailable('   ', () => true)).toBe(false)
  })

  it('is false when the picked directory is gone (drive unplugged)', () => {
    expect(isDestinationAvailable('/Volumes/Drive', () => false)).toBe(false)
  })

  it('is true when the picked directory is present', () => {
    expect(isDestinationAvailable('/Volumes/Drive', () => true)).toBe(true)
  })
})

describe('buildRsyncArgs', () => {
  it('copies contents, not the folder itself, and prunes rebuildable dirs', () => {
    const args = buildRsyncArgs('/repos/alpha', '/dest/alpha')
    expect(args).toContain('-a')
    expect(args).toContain('--delete')
    expect(args).toContain('node_modules')
    expect(args.at(-2)).toBe('/repos/alpha/')
    expect(args.at(-1)).toBe('/dest/alpha')
  })

  it('does not double the trailing slash on an already-slashed source', () => {
    expect(buildRsyncArgs('/repos/alpha/', '/dest/alpha').at(-2)).toBe('/repos/alpha/')
  })
})

describe('backupFolderNameFor', () => {
  it('prefers the label and falls back to the basename', () => {
    expect(backupFolderNameFor({ path: '/repos/alpha', label: 'Alpha App' })).toBe('Alpha App')
    expect(backupFolderNameFor({ path: '/repos/alpha' })).toBe('alpha')
    expect(backupFolderNameFor({ path: '/repos/alpha', label: '  ' })).toBe('alpha')
  })
})

describe('ExternalBackupService.runOnce', () => {
  it('does nothing while the toggle is off', async () => {
    const { service, rsync } = makeService({
      getSettings: () => ({ enabled: false, destination: '/Volumes/Drive' })
    })
    expect(await service.runOnce()).toEqual({ status: 'skipped', reason: 'disabled' })
    expect(rsync).not.toHaveBeenCalled()
  })

  it('does nothing until a destination is chosen', async () => {
    const { service, rsync } = makeService({
      getSettings: () => ({ enabled: true, destination: '' })
    })
    expect(await service.runOnce()).toEqual({ status: 'skipped', reason: 'no-destination' })
    expect(rsync).not.toHaveBeenCalled()
  })

  it('warns once when the drive is missing, not on every tick', async () => {
    const { service, rsync, onDriveMissing } = makeService({ exists: () => false })
    expect(await service.runOnce()).toEqual({
      status: 'drive-missing',
      destination: '/Volumes/Drive'
    })
    await service.runOnce()
    expect(onDriveMissing).toHaveBeenCalledTimes(1)
    expect(rsync).not.toHaveBeenCalled()
  })

  it('warns again after the drive comes back and disappears a second time', async () => {
    let present = false
    const { service, onDriveMissing } = makeService({ exists: () => present })
    await service.runOnce()
    present = true
    await service.runOnce()
    present = false
    await service.runOnce()
    expect(onDriveMissing).toHaveBeenCalledTimes(2)
  })

  it('mirrors every source and reports the count', async () => {
    const { service, rsync } = makeService({
      listSources: () => [{ path: '/repos/alpha' }, { path: '/repos/beta' }]
    })
    expect(await service.runOnce()).toEqual({ status: 'done', copied: 2, failed: [] })
    expect(rsync).toHaveBeenCalledTimes(2)
  })

  it('keeps mirroring the rest when one source fails', async () => {
    const rsync = vi.fn(async (args: string[]) => {
      if (args.some((arg) => arg.includes('/repos/alpha'))) {
        throw new Error('boom')
      }
    })
    const { service } = makeService({
      listSources: () => [{ path: '/repos/alpha' }, { path: '/repos/beta' }],
      runRsync: rsync
    })
    expect(await service.runOnce()).toEqual({
      status: 'done',
      copied: 1,
      failed: ['/repos/alpha']
    })
  })

  it('skips a source whose path no longer exists', async () => {
    const { service, rsync } = makeService({
      listSources: () => [{ path: '/repos/gone' }],
      exists: (path) => path !== '/repos/gone'
    })
    expect(await service.runOnce()).toEqual({ status: 'done', copied: 0, failed: [] })
    expect(rsync).not.toHaveBeenCalled()
  })

  it('refuses to start a second run while one is in flight', async () => {
    let release: null | (() => void) = null
    const rsync = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve as () => void
        })
    )
    const { service } = makeService({ runRsync: rsync })
    const first = service.runOnce()
    expect(await service.runOnce()).toEqual({ status: 'skipped', reason: 'already-running' })
    ;(release as (() => void) | null)?.()
    await first
    expect(rsync).toHaveBeenCalledTimes(1)
  })
})
