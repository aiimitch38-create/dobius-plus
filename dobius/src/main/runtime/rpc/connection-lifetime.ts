/** Tracks cancellation signals that end with a transport connection, not a single RPC. */
export class RpcConnectionLifetimeRegistry<Key extends object> {
  private readonly controllers = new Map<Key, AbortController>()

  open(key: Key): AbortSignal {
    this.end(key)
    const controller = new AbortController()
    this.controllers.set(key, controller)
    return controller.signal
  }

  signal(key: Key): AbortSignal | undefined {
    return this.controllers.get(key)?.signal
  }

  end(key: Key): void {
    const controller = this.controllers.get(key)
    if (!controller) {
      return
    }
    this.controllers.delete(key)
    controller.abort()
  }

  closeAll(): void {
    for (const [key, controller] of this.controllers) {
      this.controllers.delete(key)
      controller.abort()
    }
  }

  get size(): number {
    return this.controllers.size
  }
}
