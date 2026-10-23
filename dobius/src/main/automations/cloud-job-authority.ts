import { join } from 'node:path'
import { z } from 'zod'
import { CloudId, CloudProject } from '../../shared/cloud-jobs'
import { readBoundedPrivateJson, PrivateJsonError } from '../system-monitor/private-json'
import { CloudJobService } from './cloud-job-service'
import { CloudJobStore } from './cloud-jobs/store'
import type { CloudJobWorkerHost } from './cloud-job-worker-lifecycle'
import { randomUUID } from 'node:crypto'
import type { CloudJobAdamClient } from './cloud-jobs/cloud-job-adam-client'
import { CloudJobAdamOutboxDrainer } from './cloud-jobs/cloud-job-adam-drainer'
import { composeCloudJobWorkerAndReceiptHost } from './cloud-job-receipt-host'

export type CloudJobAuthorityWorkerContext = {
  baseDirectory: string
  deviceId: string
  projects: readonly CloudProject[]
  authorityAvailable: () => boolean
}
export type CloudJobAuthorityOptions = {
  adamClientFactory?: () => Pick<CloudJobAdamClient, 'consumeBinding' | 'submitReceipt'>
  // Trusted bootstrap only; worker credentials/enrollment are never runtime RPC inputs.
  workerHostFactory?: (
    context: CloudJobAuthorityWorkerContext
  ) => ((store: CloudJobStore) => CloudJobWorkerHost) | undefined
}

const Authority = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean(),
    adamReceiptBridgeEnabled: z.boolean().default(false),
    deviceId: CloudId,
    projects: z.array(CloudProject).max(100),
    workspaceAccess: z
      .array(
        z
          .object({
            workspaceId: CloudId,
            projectId: CloudId,
            deviceIds: z.array(CloudId).max(100)
          })
          .strict()
      )
      .max(1000)
  })
  .strict()
  .superRefine((config, context) => {
    if (
      new Set(config.projects.map((p) => p.id)).size !== config.projects.length ||
      config.workspaceAccess.some((entry) => !config.projects.some((p) => p.id === entry.projectId))
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid project authority bindings' })
    }
  })

function readAuthority(base: string) {
  return Authority.parse(readBoundedPrivateJson(join(base, 'authority.json')))
}

/** Only the explicitly configured headless authority opens the queue database. */
export function createCloudJobAuthority(
  userDataPath: string,
  isAuthorityHost: boolean,
  options: CloudJobAuthorityOptions = {}
): CloudJobService | undefined {
  if (!isAuthorityHost) {
    return undefined
  }
  const base = join(userDataPath, 'cloud-workstation')
  let initial: z.infer<typeof Authority>
  try {
    initial = readAuthority(base)
  } catch (error) {
    if (error instanceof PrivateJsonError && error.reason === 'missing') {
      return undefined
    }
    throw new Error('Cloud workstation authority configuration is invalid or untrusted.')
  }
  if (!initial.enabled) {
    return undefined
  }
  // A changed grant/project roster requires restart, including same-device edits.
  const initialPolicy = JSON.stringify(initial)
  const currentAuthority = () => {
    const config = readAuthority(base)
    if (JSON.stringify(config) !== initialPolicy) {
      throw new Error('Cloud workstation authority changed; restart with current registration.')
    }
    return config
  }
  const authorityAvailable = () => {
    try {
      return currentAuthority().enabled
    } catch {
      return false
    }
  }
  const createExecutorHost = options.workerHostFactory?.({
    baseDirectory: base,
    deviceId: initial.deviceId,
    projects: initial.projects,
    authorityAvailable
  })
  const adamClient = initial.adamReceiptBridgeEnabled ? options.adamClientFactory?.() : undefined
  if (initial.adamReceiptBridgeEnabled && !adamClient) {
    throw new Error('ADAM receipt bridge is enabled without a trusted client factory.')
  }
  const createWorkerHost = adamClient
    ? (store: CloudJobStore) =>
        composeCloudJobWorkerAndReceiptHost(
          createExecutorHost?.(store),
          new CloudJobAdamOutboxDrainer(store.db, adamClient, {
            authorityAvailable,
            owner: `adam-${randomUUID()}`,
            now: Date.now
          })
        )
    : createExecutorHost
  return new CloudJobService({
    authorityAvailable,
    createWorkerHost,
    ...(adamClient ? { adamClient } : {}),
    openStore: () => {
      const config = currentAuthority()
      const store = new CloudJobStore(join(base, 'jobs.sqlite'), Date.now, {
        localDeviceId: config.deviceId
      })
      try {
        // Startup is paused until enrolled worker and recovery gates are separately verified.
        store.setDispatchEnabled(false)
        for (const project of config.projects) {
          store.registerProject(project)
        }
        return store
      } catch (error) {
        store.close()
        throw error
      }
    },
    canUseWorkspace: async (principal, workspaceId, project) => {
      try {
        const config = currentAuthority()
        return (
          config.enabled &&
          config.deviceId === initial.deviceId &&
          config.projects.some((p) => JSON.stringify(p) === JSON.stringify(project)) &&
          config.workspaceAccess.some(
            (access) =>
              access.projectId === project.id &&
              access.workspaceId === workspaceId &&
              access.deviceIds.includes(principal.id)
          )
        )
      } catch {
        return false
      }
    }
  })
}
