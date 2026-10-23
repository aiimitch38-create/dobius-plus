import {
  fstatSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  renameSync,
  unlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCloudWorkerCapacityCollector,
  type ExternalWorkerReservationSnapshot,
  type WorkerCapacityExecutionPaths
} from './cloud-worker-capacity-collector'

const temporaryRoots: string[] = []
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
const testTemporaryDirectory =
  originalPlatformDescriptor.value === 'darwin' ? '/private/tmp' : tmpdir()

function pathsFixture(): WorkerCapacityExecutionPaths {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  const root = mkdtempSync(join(testTemporaryDirectory, 'dobius-capacity-'))
  temporaryRoots.push(root)
  const make = (relative: string) => {
    const path = join(root, relative)
    mkdirSync(path, { recursive: true })
    return path
  }
  return {
    roots: [{ id: 'project-a', path: make('roots/project-a') }],
    worktrees: [
      { id: 'worktree-1', path: make('worktrees/one') },
      { id: 'worktree-2', path: make('worktrees/two') }
    ],
    profileHomes: [
      { id: 'hermes-1', path: make('profiles/one') },
      { id: 'hermes-2', path: make('profiles/two') }
    ],
    stateDirectories: [{ id: 'state', path: make('state') }],
    artifactDestinations: [{ id: 'artifacts', path: make('artifacts') }]
  }
}

function snapshot(
  filesystemId: string,
  overrides: Partial<ExternalWorkerReservationSnapshot> = {}
) {
  return {
    deviceId: 'hermes-host',
    filesystemId,
    coverage: 'all_non_c02_reservations',
    complete: true,
    revision: 'revision-1',
    currentRevision: 'revision-1',
    reservedBytes: 300,
    sampledAt: 10_000,
    ...overrides
  }
}

function collectorOptions(
  paths: WorkerCapacityExecutionPaths,
  readExternalReservations?: () => unknown
) {
  const filesystemId = lstatSync(paths.worktrees[0]!.path, { bigint: true }).dev.toString()
  return {
    deviceId: 'hermes-host',
    paths,
    safetyBytes: 50,
    now: () => 10_000,
    statfsFromDescriptor: (fd) => {
      expect(fstatSync(fd, { bigint: true }).isDirectory()).toBe(true)
      return { bavail: 2_000n, bsize: 4_096n }
    },
    readExternalReservations: readExternalReservations ?? (() => snapshot(filesystemId))
  }
}

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatformDescriptor)
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('trusted worker capacity collector', () => {
  it('samples service-available filesystem bytes and validates external reservations twice', () => {
    const paths = pathsFixture()
    const filesystemId = lstatSync(paths.worktrees[0]!.path, { bigint: true }).dev.toString()
    const readReservations = vi.fn(() => snapshot(filesystemId))
    const readCapacity = createCloudWorkerCapacityCollector(
      collectorOptions(paths, readReservations)
    )

    expect(readCapacity('hermes-host')).toEqual({
      freeBytes: 8_192_000,
      externalReservedBytes: 300,
      safetyBytes: 50,
      sampledAt: 10_000
    })
    expect(readReservations).toHaveBeenCalledTimes(2)
    expect(readReservations).toHaveBeenCalledWith({
      deviceId: 'hermes-host',
      filesystemId: lstatSync(paths.worktrees[0]!.path, { bigint: true }).dev.toString()
    })
  })

  it('rejects execution paths on different filesystems before sampling', () => {
    const paths = pathsFixture()
    const inspectDirectory = (path: string) => ({
      filesystemId: path === paths.artifactDestinations[0]!.path ? '2' : '1',
      directoryInode: `${lstatSync(path, { bigint: true }).dev}:${lstatSync(path, { bigint: true }).ino}`,
      pathIdentity: realpathSync(path)
    })

    expect(() =>
      createCloudWorkerCapacityCollector({
        ...collectorOptions(paths),
        inspectDirectory
      })
    ).toThrow('share one filesystem')
  })

  it('rejects lexical aliases and rechecks a path replaced with a symlink', () => {
    const paths = pathsFixture()
    expect(() =>
      createCloudWorkerCapacityCollector({
        ...collectorOptions(paths),
        paths: {
          ...paths,
          roots: [{ id: 'project-a', path: `${paths.roots[0]!.path}/../project-a` }]
        }
      })
    ).toThrow('absolute and canonical')

    const readCapacity = createCloudWorkerCapacityCollector(collectorOptions(paths))
    const worktree = paths.worktrees[0]!.path
    const moved = `${worktree}-moved`
    const target = join(temporaryRoots[0]!, 'outside')
    mkdirSync(target)
    renameSync(worktree, moved)
    symlinkSync(target, worktree)
    expect(() => readCapacity('hermes-host')).toThrow('symlink or non-directory')
  })

  it('samples a pinned descriptor through a symlink ABA and rejects callback path replacement', () => {
    const paths = pathsFixture()
    const worktree = paths.worktrees[0]!.path
    const moved = `${worktree}-moved`
    const callbackOriginal = `${worktree}-callback-original`
    const outside = join(temporaryRoots[0]!, 'outside')
    mkdirSync(outside)
    let sampledFd: number | undefined
    const readExternalReservations = vi.fn(() => {
      const filesystemId = lstatSync(worktree, { bigint: true }).dev.toString()
      if (readExternalReservations.mock.calls.length === 2) {
        renameSync(worktree, callbackOriginal)
        symlinkSync(outside, worktree)
      }
      return snapshot(filesystemId)
    })
    const originalDescriptorSampler = (fd: number) => {
      sampledFd = fd
      const before = fstatSync(fd, { bigint: true })
      renameSync(worktree, moved)
      symlinkSync('/dev', worktree)
      const during = fstatSync(fd, { bigint: true })
      unlinkSync(worktree)
      renameSync(moved, worktree)
      expect(`${during.dev}:${during.ino}`).toBe(`${before.dev}:${before.ino}`)
      return { bavail: 100n, bsize: 1n }
    }
    const readCapacity = createCloudWorkerCapacityCollector({
      ...collectorOptions(paths, readExternalReservations),
      statfsFromDescriptor: originalDescriptorSampler
    })

    expect(() => readCapacity('hermes-host')).toThrow('symlink or non-directory')
    expect(sampledFd).toBeTypeOf('number')
    expect(() => fstatSync(sampledFd!, { bigint: true })).toThrow()
  })

  it('rejects stale, incomplete, and changed reservation authority snapshots', () => {
    const paths = pathsFixture()
    const filesystemId = lstatSync(paths.worktrees[0]!.path, { bigint: true }).dev.toString()
    const stale = createCloudWorkerCapacityCollector(
      collectorOptions(paths, () => snapshot(filesystemId, { sampledAt: 4_999 }))
    )
    expect(() => stale('hermes-host')).toThrow('incomplete, stale, or misbound')

    const incomplete = createCloudWorkerCapacityCollector(
      collectorOptions(paths, () => ({ ...snapshot(filesystemId), complete: false }))
    )
    expect(() => incomplete('hermes-host')).toThrow()

    let reads = 0
    const revoked = createCloudWorkerCapacityCollector(
      collectorOptions(paths, () => {
        reads += 1
        return reads === 1
          ? snapshot(filesystemId)
          : snapshot(filesystemId, { revision: 'revision-2', currentRevision: 'revision-2' })
      })
    )
    expect(() => revoked('hermes-host')).toThrow('changed during capacity sampling')
  })

  it('rejects a wrong device and unsafe filesystem byte multiplication', () => {
    const paths = pathsFixture()
    const wrongDevice = createCloudWorkerCapacityCollector(collectorOptions(paths))
    expect(() => wrongDevice('another-device')).toThrow('another device')

    const overflow = createCloudWorkerCapacityCollector({
      ...collectorOptions(paths),
      statfsFromDescriptor: () => ({
        bavail: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        bsize: 1n
      })
    })
    expect(() => overflow('hermes-host')).toThrow('safe integer precision')
  })

  it('refuses non-Linux sampling without a reviewed descriptor statfs primitive', () => {
    const paths = pathsFixture()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    expect(() => createCloudWorkerCapacityCollector(collectorOptions(paths))).toThrow(
      'requires Linux descriptor-bound statfs'
    )
  })

  it.skipIf(originalPlatformDescriptor.value !== 'linux')(
    'samples the opened directory through verified Linux procfs',
    () => {
      const paths = pathsFixture()
      const filesystemId = lstatSync(paths.worktrees[0]!.path, { bigint: true }).dev.toString()
      const readCapacity = createCloudWorkerCapacityCollector({
        deviceId: 'hermes-host',
        paths,
        safetyBytes: 50,
        now: () => 10_000,
        readExternalReservations: () => snapshot(filesystemId)
      })

      const sample = readCapacity('hermes-host')
      expect(sample.freeBytes).toBeGreaterThan(0)
      expect(sample.externalReservedBytes).toBe(300)
    }
  )
})
