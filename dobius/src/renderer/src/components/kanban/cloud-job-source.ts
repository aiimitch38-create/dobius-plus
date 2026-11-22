import { callRuntimeRpc, type RuntimeClientTarget } from '../../runtime/runtime-rpc-client'
import type { CloudJobActionSource } from './cloud-job-actions'

export function createCloudJobSource(
  target: Extract<RuntimeClientTarget, { kind: 'environment' }>
): CloudJobActionSource {
  if (!target.environmentId.trim()) {
    throw new Error('Choose a registered job authority')
  }
  return {
    key: `environment:${target.environmentId}`,
    read: (method, params) => callRuntimeRpc(target, method, params, { timeoutMs: 15_000 }),
    // Why: same main-process route as reads (runtimeEnvironments:call); the
    // renderer never opens the runtime socket itself.
    write: (method, params) => callRuntimeRpc(target, method, params, { timeoutMs: 15_000 })
  }
}
