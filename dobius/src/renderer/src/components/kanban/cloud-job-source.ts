import { callRuntimeRpc, type RuntimeClientTarget } from '../../runtime/runtime-rpc-client'
import type { CloudJobReadSource } from '../../../../shared/cloud-job-projection'

export function createCloudJobSource(
  target: Extract<RuntimeClientTarget, { kind: 'environment' }>
): CloudJobReadSource {
  if (!target.environmentId.trim()) {
    throw new Error('Choose a registered job authority')
  }
  return {
    key: `environment:${target.environmentId}`,
    read: (method, params) => callRuntimeRpc(target, method, params, { timeoutMs: 15_000 })
  }
}
