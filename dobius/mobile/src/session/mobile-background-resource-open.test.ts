import { describe, expect, it, vi } from 'vitest'
import { openMobileBackgroundResource } from './mobile-background-resource-open'
import type { RpcClient } from '../transport/rpc-client'

const params = { worktree: 'id:phone', relativePath: 'note.md', staged: true }
describe('mobile background opening compatibility', () => {
  it.each(['files.openBackground', 'files.openDiffBackground'] as const)(
    'uses supported %s without foreground fallback',
    async (method) => {
      const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { opened: true } })
      await openMobileBackgroundResource(
        { sendRequest } as Pick<RpcClient, 'sendRequest'>,
        method,
        params
      )
      expect(sendRequest).toHaveBeenCalledExactlyOnceWith(method, params, { timeoutMs: 15_000 })
    }
  )
  it.each([
    ['method_not_found', 'Unknown RPC method'],
    ['permission_denied', 'Method is not allowed for mobile clients'],
    ['unknown_method', 'Unknown method'],
    ['forbidden', "Method 'files.openBackground' is not available to mobile clients"]
  ])('explains old-host failure %s and never foregrounds a file', async (code, message) => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: false, error: { code, message } })
    await expect(
      openMobileBackgroundResource(
        { sendRequest } as Pick<RpcClient, 'sendRequest'>,
        'files.openBackground',
        params
      )
    ).rejects.toThrow('Host update required')
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })
  it('preserves a real host error code for the existing Git-unavailable fallback', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'git_unavailable', message: 'No Git repository' }
    })
    await expect(
      openMobileBackgroundResource(
        { sendRequest } as Pick<RpcClient, 'sendRequest'>,
        'files.openDiffBackground',
        params
      )
    ).rejects.toMatchObject({ code: 'git_unavailable', message: 'No Git repository' })
  })
  it('refuses an unsupported binary or an incomplete success response', async () => {
    const sendRequest = vi.fn().mockResolvedValue({ ok: true, result: { opened: false } })
    await expect(
      openMobileBackgroundResource(
        { sendRequest } as Pick<RpcClient, 'sendRequest'>,
        'files.openBackground',
        params
      )
    ).rejects.toThrow('cannot be opened')
  })
})
