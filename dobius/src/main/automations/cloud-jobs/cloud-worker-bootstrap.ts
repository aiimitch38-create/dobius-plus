import { join } from 'node:path'
import type { CloudWorkerCapacitySample as CapacitySample } from '../../../shared/cloud-worker-enrollment'
import type { CloudJobAuthorityWorkerContext } from '../cloud-job-authority'
import { WorkstationWorker } from '../workstation-worker/worker'
import { openDurableLeaseSealer } from '../workstation-worker/lease-sealer'
import type { WorkerRegistry } from '../workstation-worker/registry'
import { createCloudWorkerHostRuntime } from './cloud-worker-host-runtime'
import type { CloudWorkerHostRuntime } from './cloud-worker-host-runtime'
import { readPrivateWorkerConfig } from './cloud-worker-config-file'
import type { WorkerConfigGeneration } from './cloud-worker-config-file'
import { enrollmentsFromConfig } from './cloud-worker-config-schema'
import type { CloudJobStore } from './store'
import {
  assertContextProjects,
  assertStoreProjects,
  assertWorkerPrerequisites,
  ensurePrivateChildDirectory,
  prerequisitesRemainCurrent,
  sameGeneration
} from './cloud-worker-bootstrap-validation'

export type TrustedCloudWorkerCapacityReader = (deviceId: string) => CapacitySample
export type ConfiguredCloudWorkerHostFactory = (store: CloudJobStore) => CloudWorkerHostRuntime
export type ConfiguredCloudWorkerHostFactoryOptions = {
  now?: () => number
  pollIntervalMs?: number
  tickTimeoutMs?: number
}

/**
 * Loads constructor-owned workers.json and returns a store-bound host factory.
 * The caller supplies only the service's authenticated context and capacity reader;
 * this function never enables dispatch or starts/reconciles a worker.
 */
export function createConfiguredCloudWorkerHostFactory(
  context: CloudJobAuthorityWorkerContext,
  readCapacity: TrustedCloudWorkerCapacityReader | undefined,
  options: ConfiguredCloudWorkerHostFactoryOptions = {}
): ConfiguredCloudWorkerHostFactory | undefined {
  if (!readCapacity) {
    return undefined
  }
  try {
    if (!context.authorityAvailable()) {
      return undefined
    }
  } catch {
    return undefined
  }
  let initial: WorkerConfigGeneration
  try {
    initial = readPrivateWorkerConfig(context.baseDirectory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw new Error('Cloud worker configuration is invalid or untrusted.')
  }
  if (!initial.config.enabled || initial.config.deviceId !== context.deviceId) {
    return undefined
  }
  if (process.platform === 'win32') {
    throw new Error(
      'Windows descendant containment is not verified; cloud workers are unavailable.'
    )
  }
  const config = initial.config
  const now = options.now ?? Date.now
  try {
    assertContextProjects(config, context.projects)
    assertWorkerPrerequisites(context.baseDirectory, config)
  } catch {
    throw new Error('Cloud worker configuration or enrolled prerequisites are invalid.')
  }
  const profiles = config.profiles
  const enrollments = enrollmentsFromConfig(config)
  let createdStore: CloudJobStore | undefined
  let createdHost: CloudWorkerHostRuntime | undefined

  return (store) => {
    if (createdStore) {
      if (createdStore !== store || !createdHost) {
        throw new Error('Configured worker host is already bound to a different store.')
      }
      return createdHost
    }
    let authorityAvailable = false
    try {
      authorityAvailable = context.authorityAvailable()
    } catch {
      // Authority errors fail closed without exposing their contents.
    }
    if (!authorityAvailable || !sameGeneration(context.baseDirectory, initial)) {
      throw new Error('Worker authority or private configuration changed before host creation.')
    }
    try {
      assertStoreProjects(config, context.projects, store)
    } catch {
      throw new Error('Worker project authority is unavailable.')
    }
    const roots = config.roots.map((root) => ({ ...root }))
    const worktrees = config.worktrees.map((worktree) => ({ ...worktree }))
    const stateRoot = join(context.baseDirectory, 'worker-state')
    const coordinationPath = join(context.baseDirectory, 'worker-coordination')
    ensurePrivateChildDirectory(context.baseDirectory, stateRoot)
    ensurePrivateChildDirectory(context.baseDirectory, coordinationPath)
    const runtime = createCloudWorkerHostRuntime({
      store,
      slots: enrollments.map((enrollment) => {
        const stateDirectory = join(stateRoot, enrollment.workerId)
        ensurePrivateChildDirectory(stateRoot, stateDirectory)
        const statePath = join(stateDirectory, 'attempt.json')
        const registry: WorkerRegistry = {
          workerId: enrollment.workerId,
          deviceId: config.deviceId,
          roots,
          worktrees,
          recipes: config.recipes.map((recipe) => ({ ...recipe })),
          profiles
        }
        return {
          enrollment,
          createWorker(queue) {
            return new WorkstationWorker({
              registry,
              statePath,
              coordinationPath,
              queue,
              leaseSealer: openDurableLeaseSealer({ stateDirectory, journalPath: statePath })
            })
          }
        }
      }),
      readCapacity,
      readAuthority: () => ({
        ready: prerequisitesRemainCurrent(context, config, initial, readCapacity, now)
      }),
      now,
      pollIntervalMs: options.pollIntervalMs,
      tickTimeoutMs: options.tickTimeoutMs
    })
    createdStore = store
    createdHost = runtime
    return runtime
  }
}
