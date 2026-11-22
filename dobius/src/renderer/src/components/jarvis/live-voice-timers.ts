type SetTimer = (handler: () => void, ms: number) => number
type ClearTimer = (timer: number) => void

/**
 * Named one-shot timers for a call. Arming a name replaces its old timer, and
 * clearAll() on hang-up leaves nothing behind to fire into a dead call.
 */
export class NamedTimers {
  private readonly timers = new Map<string, number>()

  constructor(
    private readonly setTimer: SetTimer = (handler, ms) => window.setTimeout(handler, ms),
    private readonly clearTimer: ClearTimer = (timer) => window.clearTimeout(timer)
  ) {}

  arm(name: string, ms: number, run: () => void): void {
    this.clear(name)
    const timer = this.setTimer(() => {
      if (this.timers.get(name) === timer) {
        this.timers.delete(name)
      }
      run()
    }, ms)
    this.timers.set(name, timer)
  }

  has(name: string): boolean {
    return this.timers.has(name)
  }

  clear(name: string): void {
    const timer = this.timers.get(name)
    if (timer !== undefined) {
      this.timers.delete(name)
      this.clearTimer(timer)
    }
  }

  clearAll(): void {
    for (const timer of this.timers.values()) {
      this.clearTimer(timer)
    }
    this.timers.clear()
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.setTimer(resolve, ms)
    })
  }
}
