import { describe, expect, it } from 'vitest'
import { composeCloudJobWorkerAndReceiptHost } from './cloud-job-receipt-host'

describe('shared worker and ADAM receipt host lifetime', () => {
  it('closes before deferred startup without invoking components or reopening', async () => {
    let starts = 0
    const host = composeCloudJobWorkerAndReceiptHost(undefined, {
      start: async () => {
        starts++
      },
      stop: async () => 'drained'
    })
    const started = host.start()
    expect(await host.stop(0)).toEqual({ drained: true })
    await started
    expect(starts).toBe(0)
    await expect(host.start()).rejects.toThrow('closed')
    expect(host.executorEligibility).toBe(false)
  })

  it('cannot make receipt-only ownership eligible for worker dispatch', async () => {
    const host = composeCloudJobWorkerAndReceiptHost(undefined, {
      start: async () => undefined,
      stop: async () => 'drained'
    })
    await host.start()
    expect(host.executorEligibility).toBe(false)
    expect(await host.stop(5000)).toEqual({ drained: true })
  })

  it('preserves ownership when either component cannot drain, while requesting both stops', async () => {
    let workerStops = 0
    let receiptStops = 0
    const host = composeCloudJobWorkerAndReceiptHost(
      {
        executorEligibility: true,
        start: async () => undefined,
        stop: async () => {
          workerStops++
          throw new Error('synthetic stop failure')
        }
      },
      {
        start: async () => undefined,
        stop: async () => {
          receiptStops++
          return 'timed-out'
        }
      }
    )
    await host.start()
    expect(host.executorEligibility).toBe(true)
    expect(await host.stop(100)).toEqual({ drained: false })
    expect(workerStops).toBe(1)
    expect(receiptStops).toBe(1)
    expect(host.executorEligibility).toBe(false)
  })
})
