import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  statfsSync
} from 'node:fs'
import type { BigIntStatsFs } from 'node:fs'
import { isAbsolute, join, normalize, parse, sep } from 'node:path'
import { z } from 'zod'
import {
  CloudWorkerCapacitySample,
  type CloudWorkerCapacitySample as CapacitySample
} from '../../../shared/cloud-worker-enrollment'
import { WorkerId } from '../../../shared/workstation-worker'

const MAX_SAMPLE_AGE_MS = 5_000
const PROFILE_IDS = ['hermes-1', 'hermes-2'] as const

const ExternalReservationSnapshot = z
  .object({
    deviceId: WorkerId,
    filesystemId: z.string().regex(/^(0|[1-9][0-9]*)$/),
    coverage: z.literal('all_non_c02_reservations'),
    complete: z.literal(true),
    revision: z.string().min(1).max(256),
    currentRevision: z.string().min(1).max(256),
    reservedBytes: z.number().int().nonnegative().safe(),
    sampledAt: z.number().int().nonnegative().safe()
  })
  .strict()

export type WorkerCapacityExecutionPaths = {
  roots: readonly { id: string; path: string }[]
  worktrees: readonly { id: string; path: string }[]
  profileHomes: readonly { id: (typeof PROFILE_IDS)[number]; path: string }[]
  stateDirectories: readonly { id: string; path: string }[]
  artifactDestinations: readonly { id: string; path: string }[]
}

export type ExternalWorkerReservationSnapshot = z.infer<typeof ExternalReservationSnapshot>
export type ExternalWorkerReservationReader = (input: {
  deviceId: string
  filesystemId: string
}) => unknown

type DirectoryIdentity = {
  filesystemId: string
  directoryInode: string
  pathIdentity: string
}
type DescriptorStatFsReader = (fd: number) => Pick<BigIntStatsFs, 'bavail' | 'bsize'>
type DirectoryInspector = (path: string) => DirectoryIdentity

export type CloudWorkerCapacityCollectorOptions = {
  deviceId: string
  paths: WorkerCapacityExecutionPaths
  safetyBytes: number
  readExternalReservations: ExternalWorkerReservationReader
  now?: () => number
  /** Trusted syscall seam for deterministic tests; production uses Linux procfs descriptor statfs. */
  statfsFromDescriptor?: DescriptorStatFsReader
  inspectDirectory?: DirectoryInspector
}

/** Returns direct, fresh disk telemetry; no mutable capacity receipt is created. */
export function createCloudWorkerCapacityCollector(
  options: CloudWorkerCapacityCollectorOptions
): (requestedDeviceId: string) => CapacitySample {
  if (process.platform !== 'linux') {
    throw new Error('Worker capacity collection requires Linux descriptor-bound statfs.')
  }
  const deviceId = WorkerId.parse(options.deviceId)
  if (!Number.isSafeInteger(options.safetyBytes) || options.safetyBytes < 0) {
    throw new Error('Worker capacity safety margin is invalid.')
  }
  const paths = allApprovedPaths(options.paths)
  const inspect = options.inspectDirectory ?? inspectNoFollowDirectory
  const initial = new Map(paths.map(({ path }) => [path, inspect(path)]))
  const filesystemIds = new Set([...initial.values()].map(({ filesystemId }) => filesystemId))
  if (filesystemIds.size !== 1) {
    throw new Error('Worker execution paths must share one filesystem.')
  }
  const filesystemId = [...filesystemIds][0]!
  const statfsFromDescriptor = options.statfsFromDescriptor ?? readLinuxStatfsFromDescriptor
  const now = options.now ?? Date.now
  const samplePath = options.paths.worktrees[0]!.path

  return (requestedDeviceId) => {
    if (requestedDeviceId !== deviceId) {
      throw new Error('Capacity request targets another device.')
    }
    assertPathsCurrent(paths, initial, inspect)
    const fd = openSync(
      samplePath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
    try {
      assertOpenedDirectoryIdentity(fd, initial.get(samplePath)!)
      const disk = statfsFromDescriptor(fd)
      const freeBytes = availableDiskBytes(disk)
      const diskSampledAt = validNow(now())
      assertPathsCurrent(paths, initial, inspect)

      const first = readCurrentReservationSnapshot(
        options.readExternalReservations,
        deviceId,
        filesystemId,
        now
      )
      assertPathsCurrent(paths, initial, inspect)
      const current = readCurrentReservationSnapshot(
        options.readExternalReservations,
        deviceId,
        filesystemId,
        now
      )
      // The authority callback may race with path replacement; recheck after it returns.
      assertPathsCurrent(paths, initial, inspect)
      if (
        first.revision !== current.revision ||
        first.currentRevision !== current.currentRevision ||
        first.reservedBytes !== current.reservedBytes
      ) {
        throw new Error('External worker reservations changed during capacity sampling.')
      }
      const sampledAt = Math.min(diskSampledAt, current.sampledAt)
      if (validNow(now()) - sampledAt > MAX_SAMPLE_AGE_MS) {
        throw new Error('Worker capacity sample became stale before return.')
      }
      return CloudWorkerCapacitySample.parse({
        freeBytes,
        externalReservedBytes: current.reservedBytes,
        safetyBytes: options.safetyBytes,
        sampledAt
      })
    } finally {
      closeSync(fd)
    }
  }
}

function allApprovedPaths(paths: WorkerCapacityExecutionPaths) {
  if (
    paths.roots.length === 0 ||
    paths.worktrees.length < 2 ||
    paths.profileHomes.length !== 2 ||
    paths.stateDirectories.length === 0 ||
    !PROFILE_IDS.every((id) => paths.profileHomes.some((profile) => profile.id === id))
  ) {
    throw new Error('Capacity collection requires both Hermes profiles and all execution paths.')
  }
  const all = [
    ...paths.roots,
    ...paths.worktrees,
    ...paths.profileHomes,
    ...paths.stateDirectories,
    ...paths.artifactDestinations
  ]
  if (new Set(all.map(({ id }) => id)).size !== all.length) {
    throw new Error('Worker capacity execution path IDs must be unique.')
  }
  return all
}

function inspectNoFollowDirectory(path: string): DirectoryIdentity {
  if (!isAbsolute(path) || normalize(path) !== path) {
    throw new Error('Worker capacity path must be absolute and canonical.')
  }
  const root = parse(path).root
  let cursor = root
  let finalIdentity = ''
  let directoryInode = ''
  const components: string[] = []
  for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part)
    const stat = lstatSync(cursor, { bigint: true })
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Worker capacity path contains a symlink or non-directory.')
    }
    finalIdentity = stat.dev.toString()
    directoryInode = stat.ino.toString()
    components.push(`${stat.dev}:${stat.ino}`)
  }
  if (realpathSync(path) !== path) {
    throw new Error('Worker capacity path is not canonical.')
  }
  if (!finalIdentity) {
    const stat = lstatSync(root, { bigint: true })
    finalIdentity = stat.dev.toString()
    directoryInode = stat.ino.toString()
    components.push(`${stat.dev}:${stat.ino}`)
  }
  return {
    filesystemId: finalIdentity,
    directoryInode: `${finalIdentity}:${directoryInode}`,
    pathIdentity: components.join('/')
  }
}

function assertOpenedDirectoryIdentity(fd: number, expected: DirectoryIdentity): void {
  const opened = fstatSync(fd, { bigint: true })
  if (!opened.isDirectory() || `${opened.dev}:${opened.ino}` !== expected.directoryInode) {
    throw new Error('Opened worker worktree identity changed before capacity sampling.')
  }
}

function readLinuxStatfsFromDescriptor(fd: number): Pick<BigIntStatsFs, 'bavail' | 'bsize'> {
  if (process.platform !== 'linux') {
    throw new Error('Descriptor-bound worker statfs is supported only on Linux.')
  }
  const procfsMagic = 0x9fa0n
  const procRoot = statfsSync('/proc', { bigint: true })
  const procFdDirectory = statfsSync('/proc/self/fd', { bigint: true })
  if (procRoot.type !== procfsMagic || procFdDirectory.type !== procfsMagic) {
    throw new Error('A verified procfs descriptor path is unavailable.')
  }
  const descriptorLink = `/proc/self/fd/${fd}`
  if (!lstatSync(descriptorLink, { bigint: true }).isSymbolicLink()) {
    throw new Error('The procfs descriptor link is unavailable.')
  }
  return statfsSync(descriptorLink, { bigint: true })
}

function assertPathsCurrent(
  paths: readonly { id: string; path: string }[],
  initial: ReadonlyMap<string, DirectoryIdentity>,
  inspect: DirectoryInspector
) {
  for (const { path } of paths) {
    const before = initial.get(path)
    const current = inspect(path)
    if (
      !before ||
      current.filesystemId !== before.filesystemId ||
      current.pathIdentity !== before.pathIdentity
    ) {
      throw new Error('Worker capacity execution path identity changed.')
    }
  }
}

function availableDiskBytes(stat: Pick<BigIntStatsFs, 'bavail' | 'bsize'>): number {
  if (stat.bavail < 0n || stat.bsize <= 0n) {
    throw new Error('Worker filesystem capacity is invalid.')
  }
  const available = stat.bavail * stat.bsize
  if (available > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Worker filesystem capacity exceeds safe integer precision.')
  }
  return Number(available)
}

function readCurrentReservationSnapshot(
  reader: ExternalWorkerReservationReader,
  deviceId: string,
  filesystemId: string,
  now: () => number
): ExternalWorkerReservationSnapshot {
  const snapshot = ExternalReservationSnapshot.parse(reader({ deviceId, filesystemId }))
  const current = validNow(now())
  const age = current - snapshot.sampledAt
  if (
    snapshot.deviceId !== deviceId ||
    snapshot.filesystemId !== filesystemId ||
    snapshot.revision !== snapshot.currentRevision ||
    age < 0 ||
    age > MAX_SAMPLE_AGE_MS
  ) {
    throw new Error('External worker reservation snapshot is incomplete, stale, or misbound.')
  }
  return snapshot
}

function validNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Worker capacity clock is invalid.')
  }
  return value
}
