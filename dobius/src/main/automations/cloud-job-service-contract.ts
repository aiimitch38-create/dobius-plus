import type { CloudJob, CloudProject } from '../../shared/cloud-jobs'
import type { CloudJobAdamSubmissionClient } from './cloud-jobs/cloud-job-adam-client'
import type { CloudJobStore } from './cloud-jobs/store'
import type { CloudJobWorkerHost } from './cloud-job-worker-lifecycle'

export type CloudJobPrincipal = { kind: 'local' | 'paired'; id: string }
export type CloudJobServiceOptions = {
  openStore: () => CloudJobStore
  authorityAvailable?: () => boolean
  canUseWorkspace: (
    principal: CloudJobPrincipal,
    workspaceId: string,
    project: CloudProject
  ) => Promise<boolean>
  liveDispatchReady?: () => boolean
  createWorkerHost?: (store: CloudJobStore) => CloudJobWorkerHost
  verifyAcceptance?: (job: CloudJob, receiptId: string) => Promise<string | null>
  adamClient?: CloudJobAdamSubmissionClient
}
