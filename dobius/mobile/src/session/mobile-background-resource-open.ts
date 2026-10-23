import type { RpcClient } from '../transport/rpc-client'
import type { RpcSuccess } from '../transport/types'

/** Older hosts must refuse rather than silently treating a phone open as desktop focus. */
export async function openMobileBackgroundResource(
  client: Pick<RpcClient, 'sendRequest'>,
  method: 'files.openBackground' | 'files.openDiffBackground',
  params: { worktree: string; relativePath: string; staged?: boolean }
): Promise<RpcSuccess> {
  const response = await client.sendRequest(method, params, { timeoutMs: 15_000 })
  if (!response.ok) {
    const { code, message } = response.error
    if (
      /method_not_found|unknown_method|method_not_allowed|unsupported_method/i.test(code) ||
      /unknown method|method.*not.*(found|allowed|available|classified)|unsupported method/i.test(
        message
      )
    ) {
      throw new Error('Host update required to open files without changing desktop selection.')
    }
    throw Object.assign(new Error(message || 'Unable to open file'), { code })
  }
  const result = response.result as { opened?: boolean } | null
  if (!result || result.opened !== true) {
    throw new Error('This file cannot be opened on the host.')
  }
  return response
}
