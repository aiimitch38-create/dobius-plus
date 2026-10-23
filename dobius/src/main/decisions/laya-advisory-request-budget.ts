export type BudgetOperation<T> = (signal: AbortSignal) => Promise<T> | T

export type LayaAdvisoryBudgetLimits = {
  deadlineMs: number
  maxConcurrent: number
  maxRequestsPerMinute: number
  cacheTtlMs: number
  cacheEntries: number
}

export function boundedLayaAdvisoryLimits(options: {
  deadlineMs?: number
  maxConcurrent?: number
  maxRequestsPerMinute?: number
  cacheTtlMs?: number
  cacheEntries?: number
}): LayaAdvisoryBudgetLimits {
  return {
    deadlineMs: boundedIntegerOption(options.deadlineMs, 800, 50, 2_000, 'deadlineMs'),
    maxConcurrent: boundedIntegerOption(options.maxConcurrent, 2, 1, 8, 'maxConcurrent'),
    maxRequestsPerMinute: boundedIntegerOption(
      options.maxRequestsPerMinute,
      20,
      1,
      120,
      'maxRequestsPerMinute'
    ),
    cacheTtlMs: boundedIntegerOption(options.cacheTtlMs, 15_000, 0, 60_000, 'cacheTtlMs'),
    cacheEntries: boundedIntegerOption(options.cacheEntries, 128, 1, 512, 'cacheEntries')
  }
}

export function boundedIntegerOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  if (value !== undefined && !Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a finite safe integer.`)
  }
  return Math.max(minimum, Math.min(value ?? fallback, maximum))
}

export function pruneRequestTimestamps(requests: number[], now: number): void {
  const cutoff = now - 60_000
  while (requests.length > 0 && requests[0] <= cutoff) {
    requests.shift()
  }
}

/** One request deadline plus a slot held until every started dependency settles. */
export class LayaAdvisoryRequestBudget {
  private readonly controller = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly drainedCallbacks = new Set<() => void>()
  private readonly deadline: Promise<never>
  private readonly timer: ReturnType<typeof setTimeout>
  private deadlineReached = false

  constructor(timeoutMs: number) {
    let rejectDeadline!: (error: Error) => void
    this.deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject
    })
    this.timer = setTimeout(() => {
      this.deadlineReached = true
      this.controller.abort()
      rejectDeadline(new Error('deadline'))
    }, timeoutMs)
  }

  get expired(): boolean {
    return this.deadlineReached
  }

  async run<T>(operation: BudgetOperation<T>): Promise<T> {
    if (this.deadlineReached) {
      throw new Error('deadline')
    }
    const pending = Promise.resolve().then(() => operation(this.controller.signal))
    this.pending.add(pending)
    void pending.then(
      () => this.operationSettled(pending),
      () => this.operationSettled(pending)
    )
    return this.untilDeadline(pending)
  }

  async wait<T>(pending: Promise<T>): Promise<T> {
    if (this.deadlineReached) {
      throw new Error('deadline')
    }
    return this.untilDeadline(pending)
  }

  close(onDrained: () => void): void {
    clearTimeout(this.timer)
    if (this.pending.size === 0) {
      onDrained()
      return
    }
    this.drainedCallbacks.add(onDrained)
  }

  private async untilDeadline<T>(operation: Promise<T>): Promise<T> {
    return Promise.race([operation, this.deadline])
  }

  private operationSettled(operation: Promise<unknown>): void {
    this.pending.delete(operation)
    if (this.pending.size !== 0) {
      return
    }
    for (const callback of this.drainedCallbacks) {
      callback()
    }
    this.drainedCallbacks.clear()
  }
}
