import { createCloudJobAdamIntentSealer } from '../automations/cloud-jobs/cloud-job-adam-intent-sealer'
import { createCloudJobAdamIntentUnsealer } from '../automations/cloud-jobs/cloud-job-adam-intent-unsealer'
import type { CloudJobService } from '../automations/cloud-job-service'
import { AdamServicePrincipalRegistry } from './registry'
import { AdamCloudIntentBridge } from './adam-cloud-intent-bridge'

/** Production composition stays unavailable until main owns trusted peer and enrollment providers. */
export function createDefaultAdamCloudIntentBridge(options: {
  runtimeId: () => string
  cloudJobs: () => CloudJobService | undefined
}): AdamCloudIntentBridge {
  return new AdamCloudIntentBridge({
    registry: AdamServicePrincipalRegistry.unavailable(),
    sealer: createCloudJobAdamIntentSealer(),
    unsealer: createCloudJobAdamIntentUnsealer(),
    runtimeId: options.runtimeId,
    cloudJobs: options.cloudJobs
  })
}
