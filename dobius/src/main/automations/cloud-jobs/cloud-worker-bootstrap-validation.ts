import { accessSync, constants, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import type { CloudProject } from '../../../shared/cloud-jobs'
import { CloudWorkerCapacitySample } from '../../../shared/cloud-worker-enrollment'
import type { CloudWorkerCapacitySample as CapacitySample } from '../../../shared/cloud-worker-enrollment'
import type { HermesProfileRegistration } from '../../../shared/workstation-worker'
import type { CloudJobAuthorityWorkerContext } from '../cloud-job-authority'
import { assertExecutionDirectorySeparation } from '../workstation-worker/execution-directory-separation'
import { validateHermesProfileRegistrations } from '../workstation-worker/registry'
import type { WorkerConfigGeneration } from './cloud-worker-config-file'
import { readPrivateWorkerConfig } from './cloud-worker-config-file'
import type { EnabledCloudWorkerConfig } from './cloud-worker-config-schema'
import type { CloudJobStore } from './store'

export function assertFreshCapacity(input: CapacitySample, now: () => number) {
  const sample = CloudWorkerCapacitySample.parse(input)
  const age = now() - sample.sampledAt
  if (age < 0 || age > 5_000) {
    throw new Error('Worker capacity receipt is stale or from the future.')
  }
}

export function sameGeneration(baseDirectory: string, expected: WorkerConfigGeneration) {
  const current = readPrivateWorkerConfig(baseDirectory)
  return current.sha256 === expected.sha256 && current.fileIdentity === expected.fileIdentity
}

export function assertContextProjects(
  config: EnabledCloudWorkerConfig,
  projects: readonly CloudProject[]
) {
  for (const binding of config.projectBindings) {
    const project = projects.find((entry) => entry.id === binding.projectId)
    const root = config.roots.find((entry) => entry.id === binding.rootId)
    const workers = config.workers.filter((worker) =>
      worker.assignments.some((assignment) => assignment.projectId === binding.projectId)
    )
    const assignments = workerAssignmentsForProject(config, binding.projectId)
    if (
      !project ||
      !root ||
      project.deviceId !== config.deviceId ||
      project.root !== root.canonicalPath ||
      workers.some((worker) => !worker.capabilities.includes(project.capability)) ||
      !assignments.every((assignment) => project.recipes.includes(assignment.recipeId)) ||
      assignments.length === 0
    ) {
      throw new Error('Worker project bindings do not match service authority.')
    }
  }
}

export function assertStoreProjects(
  config: EnabledCloudWorkerConfig,
  projects: readonly CloudProject[],
  store: CloudJobStore
) {
  assertContextProjects(config, projects)
  for (const binding of config.projectBindings) {
    const authorized = projects.find((project) => project.id === binding.projectId)!
    const registered = store.project(binding.projectId)
    if (
      registered.id !== authorized.id ||
      registered.deviceId !== authorized.deviceId ||
      registered.root !== authorized.root ||
      registered.capability !== authorized.capability ||
      JSON.stringify([...registered.recipes].sort()) !==
        JSON.stringify([...authorized.recipes].sort()) ||
      !store.projectRootIsFresh(binding.projectId, config.deviceId)
    ) {
      throw new Error('Worker project registration is absent or stale in the durable store.')
    }
  }
}

export function prerequisitesRemainCurrent(
  context: CloudJobAuthorityWorkerContext,
  config: EnabledCloudWorkerConfig,
  generation: WorkerConfigGeneration,
  readCapacity: (deviceId: string) => CapacitySample,
  now: () => number
) {
  try {
    if (!context.authorityAvailable() || !sameGeneration(context.baseDirectory, generation)) {
      return false
    }
    assertContextProjects(config, context.projects)
    assertWorkerPrerequisites(context.baseDirectory, config)
    assertFreshCapacity(readCapacity(context.deviceId), now)
    return true
  } catch {
    return false
  }
}

export function assertWorkerPrerequisites(baseDirectory: string, config: EnabledCloudWorkerConfig) {
  const profiles = config.profiles as HermesProfileRegistration[]
  validateHermesProfileRegistrations(profiles)
  const rootIdentities = new Set(
    config.roots.map((root) => assertDirectory(root.canonicalPath, false).identity)
  )
  const worktreeIdentityById = new Map<string, string>()
  const enrolledDirectoryIdentities = new Set<string>()
  for (const worktree of config.worktrees) {
    const identity = assertDirectory(worktree.canonicalPath, false).identity
    if (rootIdentities.has(identity) || enrolledDirectoryIdentities.has(identity)) {
      throw new Error('Worker worktrees cannot alias an enrolled root or another worktree.')
    }
    enrolledDirectoryIdentities.add(identity)
    worktreeIdentityById.set(worktree.id, identity)
  }
  const profileHomes = new Set<string>()
  for (const profile of profiles) {
    const home = assertDirectory(profile.home, true)
    const worktreeIdentity = worktreeIdentityById.get(profile.worktreeId)
    if (
      !worktreeIdentity ||
      !profile.authVerified ||
      !profile.runtimeVerified ||
      !profile.credentialRef
    ) {
      throw new Error('Hermes profile prerequisites are not verified.')
    }
    if (rootIdentities.has(home.identity)) {
      throw new Error('Hermes profile homes cannot alias an enrolled project root.')
    }
    if (profileHomes.has(home.identity)) {
      throw new Error('Hermes profiles must use distinct physical homes and worktrees.')
    }
    if (enrolledDirectoryIdentities.has(home.identity)) {
      throw new Error('Hermes profile homes and worktrees cannot alias each other.')
    }
    profileHomes.add(home.identity)
    enrolledDirectoryIdentities.add(home.identity)
  }
  assertExecutionDirectorySeparation({
    roots: config.roots,
    worktrees: config.worktrees,
    profiles
  })
  for (const recipe of config.recipes) {
    if (!isAbsolute(recipe.executable) || realpathSync(recipe.executable) !== recipe.executable) {
      throw new Error('Worker recipe executable is not canonical.')
    }
    const before = lstatSync(recipe.executable, { bigint: true })
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      (before.mode & 0o022n) !== 0n ||
      (typeof process.getuid === 'function' && before.uid !== BigInt(process.getuid()))
    ) {
      throw new Error('Worker recipe executable is not a trusted non-writable regular file.')
    }
    accessSync(recipe.executable, constants.X_OK)
    const after = lstatSync(recipe.executable, { bigint: true })
    if (!samePhysicalFileVersion(before, after)) {
      throw new Error('Worker recipe identity changed during prerequisite validation.')
    }
  }
  const base = lstatSync(baseDirectory)
  if (base.isSymbolicLink() || !base.isDirectory()) {
    throw new Error('Worker state base is not a real directory.')
  }
}

export function ensurePrivateChildDirectory(parent: string, path: string) {
  if (dirname(path) !== parent) {
    throw new Error('Worker state directory escaped its service-owned parent.')
  }
  try {
    mkdirSync(path, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
  const stat = lstatSync(path)
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
    realpathSync(path) !== path
  ) {
    throw new Error('Worker state directory is not a private service-owned directory.')
  }
}

function workerAssignmentsForProject(config: EnabledCloudWorkerConfig, projectId: string) {
  return config.workers.flatMap((worker) =>
    worker.assignments
      .filter((assignment) => assignment.projectId === projectId)
      .map((assignment) => ({ ...assignment, profileId: worker.profileId }))
  )
}

function assertDirectory(path: string, privateDirectory: boolean) {
  const pathStat = lstatSync(path, { bigint: true })
  if (
    !pathStat.isDirectory() ||
    pathStat.isSymbolicLink() ||
    realpathSync(path) !== path ||
    (pathStat.mode & 0o7000n) !== 0n ||
    (privateDirectory && (pathStat.mode & 0o077n) !== 0n) ||
    (typeof process.getuid === 'function' && pathStat.uid !== BigInt(process.getuid()))
  ) {
    throw new Error('Worker enrollment directory is missing, non-canonical, or untrusted.')
  }
  return { identity: `${pathStat.dev.toString()}:${pathStat.ino.toString()}` }
}

function samePhysicalFileVersion(left: BigIntStats, right: BigIntStats) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}
