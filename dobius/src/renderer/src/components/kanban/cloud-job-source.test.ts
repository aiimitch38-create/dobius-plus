import { describe, it, expect, vi } from 'vitest'
import { createCloudJobSource } from './cloud-job-source'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
vi.mock('../../runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: vi.fn().mockResolvedValue({})
}))
describe('pinned desktop job transport', () => {
  it('uses the explicit environment for every read and never derives an active runtime', async () => {
    const source = createCloudJobSource({ kind: 'environment', environmentId: 'vps-pinned' })
    await source.read('jobs.snapshot', { limit: 200 })
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'vps-pinned' },
      'jobs.snapshot',
      { limit: 200 },
      { timeoutMs: 15_000 }
    )
    expect(source.key).toBe('environment:vps-pinned')
  })
  it('requires an explicit target rather than falling back to local', () => {
    expect(() => createCloudJobSource({ kind: 'environment', environmentId: '' })).toThrow('Choose')
  })
})
