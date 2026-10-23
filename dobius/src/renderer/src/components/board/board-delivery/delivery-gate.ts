// One serialized queue for every message the Board types into a console.
// Why: consoles share one keyboard path; two deliveries interleaving would mix
// their text, and a console sitting on a permission dialog would have the
// dialog eat the keystrokes. So the gate types one message at a time and holds
// a message while its console is on a dialog.

export type ConsoleDeliveryState =
  | 'idle'
  | 'working'
  | 'done'
  /** Permission dialog or a question for the user. */
  | 'waiting'
  | 'blocked'
  | 'paused'
  /** The agent exited and the terminal is a bare shell. */
  | 'shell'
  | 'gone'

export type DeliveryDecision =
  | { kind: 'send'; busy: boolean }
  | { kind: 'hold' }
  | { kind: 'skip'; reason: 'paused' | 'shell' | 'gone' }

export function deliveryDecision(state: ConsoleDeliveryState): DeliveryDecision {
  switch (state) {
    case 'idle':
    case 'done':
      return { kind: 'send', busy: false }
    case 'working':
      // The agent's terminal queues the text after its current turn.
      return { kind: 'send', busy: true }
    case 'waiting':
    case 'blocked':
      return { kind: 'hold' }
    case 'paused':
    case 'shell':
    case 'gone':
      return { kind: 'skip', reason: state }
  }
}

export type DeliveryOutcome =
  | { kind: 'sent'; busy: boolean }
  | { kind: 'skipped'; reason: 'paused' | 'shell' | 'gone' | 'held-too-long' | 'cancelled' }
  | { kind: 'failed'; reason: string }

export type DeliveryRequest = {
  /** Stable id of the order this message belongs to (for cancel). */
  orderId: string
  tabId: string
  text: string
}

export type DeliveryDeps = {
  stateOf: (tabId: string) => ConsoleDeliveryState
  /** Performs the guarded paste+Enter; resolves 'sent' or a failure reason. */
  send: (tabId: string, text: string) => Promise<'sent' | 'shell' | string>
  wait: (ms: number) => Promise<void>
  now: () => number
  /** Called once when a message starts waiting on a dialog. */
  onHold?: (request: DeliveryRequest) => void
}

export const HOLD_POLL_MS = 2_000
export const HOLD_MAX_MS = 5 * 60 * 1000

// Why per console: a message waiting on one console's dialog must not hold up
// every other console for up to 5 minutes. Each console gets its own ordered
// chain; only the act of typing is serialized across consoles.
export class DeliveryGate {
  private readonly chains = new Map<string, Promise<void>>()
  private typing: Promise<unknown> = Promise.resolve()
  private readonly cancelled = new Set<string>()
  /** Requests not yet typed (or skipped), for cancel counts. */
  private readonly untyped = new Set<DeliveryRequest>()

  constructor(private readonly deps: DeliveryDeps) {}

  enqueue(request: DeliveryRequest): Promise<DeliveryOutcome> {
    this.untyped.add(request)
    return new Promise((resolve) => {
      const prev = this.chains.get(request.tabId) ?? Promise.resolve()
      const run = prev.then(async () => {
        const outcome = await this.deliverOne(request)
        this.untyped.delete(request)
        resolve(outcome)
      })
      this.chains.set(
        request.tabId,
        run.catch((error: unknown) => console.error('[board-delivery] chain failed', error))
      )
    })
  }

  /** Drops every not-yet-typed message of an order; returns how many were dropped. */
  cancelOrder(orderId: string): number {
    this.cancelled.add(orderId)
    return [...this.untyped].filter((r) => r.orderId === orderId).length
  }

  pending(): number {
    return this.untyped.size
  }

  private withTyping<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.typing.then(fn)
    this.typing = run.catch(() => undefined)
    return run
  }

  private async deliverOne(request: DeliveryRequest): Promise<DeliveryOutcome> {
    const started = this.deps.now()
    let notified = false
    for (;;) {
      if (this.cancelled.has(request.orderId)) {
        return { kind: 'skipped', reason: 'cancelled' }
      }
      const decision = deliveryDecision(this.deps.stateOf(request.tabId))
      if (decision.kind === 'skip') {
        return { kind: 'skipped', reason: decision.reason }
      }
      if (decision.kind === 'hold') {
        if (this.deps.now() - started >= HOLD_MAX_MS) {
          return { kind: 'skipped', reason: 'held-too-long' }
        }
        if (!notified) {
          notified = true
          this.deps.onHold?.(request)
        }
        await this.deps.wait(HOLD_POLL_MS)
        continue
      }
      return this.withTyping(async () => {
        // Re-check after waiting for the typing slot: cancel may have landed.
        if (this.cancelled.has(request.orderId)) {
          return { kind: 'skipped', reason: 'cancelled' } as const
        }
        try {
          const result = await this.deps.send(request.tabId, request.text)
          if (result === 'sent') {
            return { kind: 'sent', busy: decision.busy } as const
          }
          return result === 'shell'
            ? ({ kind: 'skipped', reason: 'shell' } as const)
            : ({ kind: 'failed', reason: result } as const)
        } catch (error) {
          return {
            kind: 'failed',
            reason: error instanceof Error ? error.message : String(error)
          } as const
        }
      })
    }
  }
}
