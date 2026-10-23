import { describe, expect, it } from 'vitest'
import { request } from './laya-http-provider.fixtures'
import { providerHarness } from './laya-http-provider.test-support'

describe('Laya HTTP provider epoch-to-fetch boundary', () => {
  it('does not send authenticated health when the epoch changes after receipt validation', async () => {
    let epoch = 4
    const { provider, calls } = providerHarness({
      epoch: () => epoch
    })
    const internals = provider as unknown as {
      readReceipt: (...args: unknown[]) => Promise<unknown>
    }
    const readReceipt = internals.readReceipt.bind(provider)
    let reads = 0
    internals.readReceipt = (...args) => {
      reads += 1
      const result = readReceipt(...args)
      if (reads === 2) {
        return result.then((receipt) => {
          queueMicrotask(() => {
            epoch = 5
          })
          return receipt
        })
      }
      return result
    }

    expect(await provider.availability('kanban', new AbortController().signal)).toBe('unavailable')
    expect(calls).toHaveLength(0)
  })

  it('does not send the bearer-authenticated inference after assertCurrent resolves stale', async () => {
    let epoch = 4
    const { provider, calls } = providerHarness({
      epoch: () => epoch
    })
    const internals = provider as unknown as {
      assertCurrent: (...args: unknown[]) => Promise<unknown>
    }
    const assertCurrent = internals.assertCurrent.bind(provider)
    internals.assertCurrent = (...args) =>
      assertCurrent(...args).then((receipt) => {
        // This runs after assertCurrent's promise fulfills and before decide resumes after await.
        queueMicrotask(() => {
          epoch = 5
        })
        return receipt
      })

    await expect(provider.decide(request(), new AbortController().signal)).rejects.toThrow(
      /epoch changed/
    )
    expect(calls.map(({ url }) => new URL(url).pathname)).toEqual(['/health'])
    expect(
      calls.some(({ url, init }) => new URL(url).pathname === '/v1/systemone' && init.headers)
    ).toBe(false)
  })
})
