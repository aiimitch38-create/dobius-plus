import { lstatSync, realpathSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { assertExecutionDirectorySeparation } from './execution-directory-separation'
import {
  HERMES_PROFILE_IDS,
  type EnrolledRoot,
  type EnrolledWorktree,
  type HermesProfileRegistration,
  type RegisteredRecipe,
  type WorkerJob
} from '../../../shared/workstation-worker'

export type WorkerRegistry = {
  workerId: string
  deviceId: string
  recipes: readonly RegisteredRecipe[]
  roots: readonly EnrolledRoot[]
  worktrees: readonly EnrolledWorktree[]
  profiles: readonly HermesProfileRegistration[]
}

export type FileIdentity = { dev: string; ino: string }
export type ExecutionIdentity = {
  root: FileIdentity
  worktree: FileIdentity
  profileHome?: FileIdentity
}

function fileIdentity(path: string): FileIdentity {
  const stat = statSync(path, { bigint: true })
  return { dev: String(stat.dev), ino: String(stat.ino) }
}

function resolvePrivateProfileHome(path: string) {
  if (!isAbsolute(path) || realpathSync(path) !== path || lstatSync(path).isSymbolicLink()) {
    throw new Error('Hermes profile home must be a canonical real directory, not a symlink.')
  }
  const stat = statSync(path, { bigint: true })
  if (!stat.isDirectory() || (stat.mode & 0o077n) !== 0n) {
    throw new Error('Hermes profile home must be a private directory with no group/world access.')
  }
  if (typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid())) {
    throw new Error('Hermes profile home must be owned by the worker service account.')
  }
  return { path, identity: { dev: String(stat.dev), ino: String(stat.ino) } }
}

function sameIdentity(left: FileIdentity, right: FileIdentity) {
  return left.dev === right.dev && left.ino === right.ino
}

export function validateHermesProfileRegistrations(profiles: readonly HermesProfileRegistration[]) {
  if (
    profiles.length !== HERMES_PROFILE_IDS.length ||
    HERMES_PROFILE_IDS.some((id) => profiles.filter((profile) => profile.id === id).length !== 1)
  ) {
    throw new Error('Exactly two separately enrolled Hermes profile slots are required.')
  }
  if (
    new Set(profiles.map((profile) => profile.home)).size !== HERMES_PROFILE_IDS.length ||
    new Set(profiles.map((profile) => profile.worktreeId)).size !== HERMES_PROFILE_IDS.length
  ) {
    throw new Error('Hermes profile homes and worktrees must each be exclusive.')
  }
  if (
    profiles.some(
      (profile) =>
        !profile.credentialRef || !profile.allowedRoots.length || !profile.allowedRecipes.length
    )
  ) {
    throw new Error(
      'Hermes profile registration is missing credential reference or policy bindings.'
    )
  }
  return profiles
}

export function resolveExecution(registry: WorkerRegistry, job: WorkerJob) {
  if (job.deviceId !== registry.deviceId) {
    throw new Error('Job targets another enrolled device.')
  }
  assertExecutionDirectorySeparation(registry)
  const root = registry.roots.find((entry) => entry.id === job.rootId)
  if (
    !root ||
    !root.allowedRecipes.includes(job.recipeId) ||
    !root.allowedWorktrees.includes(job.worktreeId)
  ) {
    throw new Error('Root, recipe, or worktree is not enrolled for this device.')
  }
  const worktree = registry.worktrees.find(
    (entry) => entry.id === job.worktreeId && entry.rootId === root.id
  )
  if (!worktree || !root.allowedWorktrees.includes(worktree.id)) {
    throw new Error('Worktree is not enrolled under this root.')
  }
  if (
    !isAbsolute(root.canonicalPath) ||
    realpathSync(root.canonicalPath) !== root.canonicalPath ||
    !statSync(root.canonicalPath).isDirectory()
  ) {
    throw new Error('Enrolled root is missing or changed.')
  }
  if (
    !isAbsolute(worktree.canonicalPath) ||
    realpathSync(worktree.canonicalPath) !== worktree.canonicalPath ||
    !statSync(worktree.canonicalPath).isDirectory()
  ) {
    throw new Error('Enrolled worktree is missing or changed.')
  }
  const registeredWorktrees = execGit(['-C', root.canonicalPath, 'worktree', 'list', '--porcelain'])
  if (
    !registeredWorktrees.split('\n').some((line) => line === `worktree ${worktree.canonicalPath}`)
  ) {
    throw new Error('Worktree is not linked to the enrolled repository.')
  }
  const revision = execGit(['-C', worktree.canonicalPath, 'rev-parse', '--verify', 'HEAD'])
  if (revision !== job.sourceRevision) {
    throw new Error('Repository revision does not match the exact enrolled job revision.')
  }
  if (
    execGit(['-C', worktree.canonicalPath, 'status', '--porcelain=v1', '--untracked-files=all'])
  ) {
    throw new Error(
      'Job source worktree is dirty or has untracked files; refusing commit-only execution.'
    )
  }
  const recipe = registry.recipes.find((entry) => entry.id === job.recipeId)
  if (!recipe || !isAbsolute(recipe.executable)) {
    throw new Error('Recipe is not registered with an absolute executable.')
  }
  if (
    job.caps.wallTimeMs > recipe.maxCaps.wallTimeMs ||
    job.caps.outputBytes > recipe.maxCaps.outputBytes ||
    job.caps.artifactBytes > recipe.maxCaps.artifactBytes ||
    job.caps.memoryBytes > recipe.maxCaps.memoryBytes ||
    job.caps.cpuCount > recipe.maxCaps.cpuCount
  ) {
    throw new Error('Job exceeds the registered recipe resource caps.')
  }
  let profileHome: string | undefined
  let profileHomeIdentity: FileIdentity | undefined
  if (recipe.hermesProfileId) {
    validateHermesProfileRegistrations(registry.profiles)
    const profile = registry.profiles.find((entry) => entry.id === job.profileId)
    if (
      !profile ||
      profile.id !== recipe.hermesProfileId ||
      profile.worktreeId !== job.worktreeId ||
      !profile.allowedRoots.includes(root.id) ||
      !profile.allowedRecipes.includes(recipe.id)
    ) {
      throw new Error('Hermes profile registration does not match this job.')
    }
    if (!profile.authVerified || !profile.runtimeVerified || !profile.credentialRef) {
      throw new Error('Hermes profile authentication/runtime is unverified.')
    }
    const registeredHomes = registry.profiles.map((entry) => resolvePrivateProfileHome(entry.home))
    if (
      new Set(registeredHomes.map((entry) => `${entry.identity.dev}:${entry.identity.ino}`))
        .size !== HERMES_PROFILE_IDS.length
    ) {
      throw new Error('Hermes profile home is reused.')
    }
    const selectedHome = resolvePrivateProfileHome(profile.home)
    if (
      registeredHomes.some(
        (entry) =>
          entry.path !== selectedHome.path && sameIdentity(entry.identity, selectedHome.identity)
      )
    ) {
      throw new Error('Hermes profile home is reused.')
    }
    profileHome = selectedHome.path
    profileHomeIdentity = selectedHome.identity
  } else if (job.profileId !== 'fixture') {
    throw new Error('Recipe does not authorize the requested profile.')
  }
  const argv = recipe.argv.map((arg) =>
    arg
      .replaceAll('{root}', root.canonicalPath)
      .replaceAll('{worktree}', worktree.canonicalPath)
      .replaceAll('{projectRoot}', root.canonicalPath)
      .replaceAll('{revision}', job.sourceRevision)
      .replaceAll('{worktree}', job.worktreeId)
  )
  if (argv.some((arg) => /\{[^}]+\}/.test(arg))) {
    throw new Error('Recipe contains an unsupported argument placeholder.')
  }
  const identity: ExecutionIdentity = {
    root: fileIdentity(root.canonicalPath),
    worktree: fileIdentity(worktree.canonicalPath),
    ...(profileHomeIdentity ? { profileHome: profileHomeIdentity } : {})
  }
  return {
    root: root.canonicalPath,
    worktree: worktree.canonicalPath,
    recipe,
    argv,
    profileHome,
    identity
  }
}

function execGit(args: string[]) {
  return String(
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  ).trim()
}
