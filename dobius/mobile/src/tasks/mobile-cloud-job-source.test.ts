import { describe, expect, it, vi } from 'vitest'
import { createMobileCloudJobSource } from './mobile-cloud-job-source'
describe('explicit phone job host', () => {
  it('uses the selected host client and preserves actual response/identity errors', async () => {
    const client = {
      sendRequest: vi
        .fn()
        .mockResolvedValue({ ok: true, result: { generation: 'host-generation' } })
    }
    const source = createMobileCloudJobSource('host-id', client)
    expect(source.key).toBe('host:host-id')
    expect(await source.read('jobs.status')).toEqual({ generation: 'host-generation' })
    client.sendRequest.mockResolvedValueOnce({
      ok: false,
      error: { code: 'forbidden', message: 'denied' }
    })
    await expect(source.read('jobs.events', { after: 0, limit: 200 })).rejects.toMatchObject({
      code: 'forbidden'
    })
    expect(client.sendRequest).toHaveBeenLastCalledWith(
      'jobs.events',
      { after: 0, limit: 200 },
      { timeoutMs: 15_000 }
    )
  })
  it('does not read from an implicit host', () => {
    expect(() => createMobileCloudJobSource('', { sendRequest: vi.fn() })).toThrow('host')
  })
})
