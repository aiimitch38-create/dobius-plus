import type { RpcClient } from '../transport/rpc-client'
import type { CloudJobReadSource } from '../../../src/shared/cloud-job-projection'
export function createMobileCloudJobSource(
  hostId: string,
  client: Pick<RpcClient, 'sendRequest'>
): CloudJobReadSource {
  if (!hostId) {
    throw new Error('A host must be selected')
  }
  return {
    key: `host:${hostId}`,
    read: async (method, params) => {
      const response = await client.sendRequest(method, params, { timeoutMs: 15_000 })
      if (!response.ok) {
        throw Object.assign(new Error(response.error.message), { code: response.error.code })
      }
      return response.result
    }
  }
}
