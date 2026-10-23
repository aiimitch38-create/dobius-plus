import type { CloudJobWorkerHost } from './cloud-job-worker-lifecycle'

export type CloudJobReceiptHost = {
  start(): Promise<unknown>
  stop(timeoutMs: number): Promise<'drained' | 'timed-out'>
}

/** Both components share one DB; neither may outlive a reported successful owner drain. */
export function composeCloudJobWorkerAndReceiptHost(
  worker: CloudJobWorkerHost | undefined,
  receipts: CloudJobReceiptHost
): CloudJobWorkerHost {
  let closing = false
  let started = false
  return {
    get executorEligibility() {
      return !closing && worker?.executorEligibility === true
    },
    start() {
      if (started || closing) {
        return Promise.reject(new Error('Cloud receipt host already started or closed.'))
      }
      started = true
      // Publish the owner startup latch before invoking either injected component.
      return Promise.all([
        Promise.resolve().then(() => (closing ? undefined : worker?.start())),
        Promise.resolve().then(() => (closing ? undefined : receipts.start()))
      ]).then(() => undefined)
    },
    async stop(timeoutMs) {
      closing = true
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) {
        throw new Error('Cloud receipt host shutdown timeout is invalid.')
      }
      const outcomes = await Promise.allSettled([
        Promise.resolve().then(() => worker?.stop(timeoutMs) ?? { drained: true }),
        Promise.resolve().then(() => receipts.stop(Math.min(timeoutMs, 30_000)))
      ])
      return {
        drained:
          outcomes[0].status === 'fulfilled' &&
          outcomes[0].value.drained &&
          outcomes[1].status === 'fulfilled' &&
          outcomes[1].value === 'drained'
      }
    }
  }
}
