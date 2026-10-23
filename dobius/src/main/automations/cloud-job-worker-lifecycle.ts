import type { CloudJobStore } from './cloud-jobs/store'

export type CloudJobWorkerHost = {
  start(): Promise<void>
  stop(timeoutMs: number): Promise<{ drained: boolean }>
  readonly executorEligibility: boolean
}

/** The API owner retains its store until startup and worker drain both finish. */
export class CloudJobWorkerLifecycle {
  private host: CloudJobWorkerHost | null = null
  private started: Promise<void> = Promise.resolve()
  private recovered = false
  private stopping = false
  private stopTask: Promise<boolean> | null = null

  constructor(private readonly createHost?: (store: CloudJobStore) => CloudJobWorkerHost) {}

  attach(store: CloudJobStore): void {
    if (!this.createHost) {
      return
    }
    if (this.host || this.stopping) {
      throw new Error('Worker host is already attached or stopping.')
    }
    const host = this.createHost(store)
    this.host = host
    try {
      this.started = Promise.resolve(host.start()).then(
        () => {
          this.recovered = !this.stopping
        },
        () => {
          this.recovered = false
        }
      )
    } catch {
      this.recovered = false
    }
  }

  get attached(): boolean {
    return this.host !== null
  }

  get closing(): boolean {
    return this.stopping
  }

  get eligible(): boolean {
    if (!this.host || !this.recovered || this.stopping) {
      return false
    }
    try {
      return this.host.executorEligibility === true
    } catch {
      return false
    }
  }

  shutdown(timeoutMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) {
      return Promise.reject(new Error('Worker shutdown timeout must be between 0 and 60000 ms.'))
    }
    this.stopping = true
    this.recovered = false
    if (!this.host) {
      return Promise.resolve(true)
    }
    if (this.stopTask) {
      return this.stopTask
    }
    const host = this.host
    this.stopTask = this.drain(host, timeoutMs).finally(() => {
      this.stopTask = null
    })
    return this.stopTask
  }

  private async drain(host: CloudJobWorkerHost, timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })
    try {
      // A host cannot authorize store closure while a delayed startup still owns it.
      const drained = Promise.all([this.started, host.stop(timeoutMs)]).then(
        ([, result]) => result.drained === true,
        () => false
      )
      return await Promise.race([drained, expired])
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }
}
