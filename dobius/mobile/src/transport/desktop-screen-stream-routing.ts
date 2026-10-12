import {
  decodeDesktopScreenFrame,
  matchesDesktopScreenSession,
  type DesktopScreenFrame,
  type DesktopScreenSession
} from '../../../src/shared/desktop-screen-protocol'

type Ready = DesktopScreenSession & { type: 'ready'; width: number; height: number }
type Entry = {
  listener?: (event: unknown) => void
  frame?: (frame: DesktopScreenFrame) => void
  session?: Ready
  sequence: number
  cancelled: boolean
}
export function desktopScreenReady(value: unknown): Ready | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const item = value as Partial<Ready>
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  return item.type === 'ready' &&
    typeof item.subscriptionId === 'string' &&
    uuid.test(item.subscriptionId) &&
    typeof item.generation === 'string' &&
    uuid.test(item.generation) &&
    Number.isInteger(item.displayId) &&
    Number.isInteger(item.width) &&
    Number.isInteger(item.height) &&
    item.width! > 0 &&
    item.width! <= 1280 &&
    item.height! > 0 &&
    item.height! <= 1280
    ? (item as Ready)
    : null
}

// Cancelled entries retain only a bounded tombstone, never a component callback or an image reference.
export class DesktopScreenStreamRouting {
  private entries = new Map<string, Entry>()
  constructor(
    private readonly unsubscribe: (session: DesktopScreenSession) => void,
    private readonly removeRequest: (id: string) => void,
    private readonly cancelPending?: (id: string) => void
  ) {}
  register(
    id: string,
    listener: (event: unknown) => void,
    frame?: (frame: DesktopScreenFrame) => void
  ): void {
    this.entries.set(id, { listener, frame, sequence: 0, cancelled: false })
  }
  remove(id: string): void {
    this.entries.delete(id)
  }
  cancel(id: string, sent: boolean): void {
    const entry = this.entries.get(id)
    if (!entry) {
      return
    }
    entry.cancelled = true
    entry.listener = undefined
    entry.frame = undefined
    if (entry.session) {
      this.unsubscribe(entry.session)
    }
    if (!entry.session && sent) {
      this.cancelPending?.(id)
    }
    if (entry.session || !sent) {
      this.entries.delete(id)
      this.removeRequest(id)
    }
    const tombstones = [...this.entries].filter(([, item]) => item.cancelled)
    for (const [oldest] of tombstones.slice(0, Math.max(0, tombstones.length - 32))) {
      this.entries.delete(oldest)
      this.removeRequest(oldest)
    }
  }
  ready(id: string, value: unknown): boolean {
    const ready = desktopScreenReady(value)
    if (!ready) {
      return false
    }
    const entry = this.entries.get(id)
    if (!entry || entry.cancelled) {
      this.unsubscribe(ready)
      this.entries.delete(id)
      this.removeRequest(id)
      return true
    }
    if (entry.session) {
      if (
        entry.session.subscriptionId === ready.subscriptionId &&
        entry.session.generation === ready.generation
      ) {
        return true
      }
      this.unsubscribe(ready)
      entry.listener?.({ type: 'end', reason: 'stopped' })
      this.cancel(id, true)
      return true
    }
    entry.session = ready
    entry.sequence = 0
    entry.listener?.(ready)
    return true
  }
  event(id: string, value: unknown): void {
    const entry = this.entries.get(id)
    if (!entry || entry.cancelled) {
      return
    }
    entry.listener?.(value)
    if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'end') {
      this.entries.delete(id)
      this.removeRequest(id)
    }
  }
  binary(bytes: Uint8Array): boolean {
    const frame = decodeDesktopScreenFrame(bytes)
    if (!frame) {
      return false
    }
    for (const entry of this.entries.values()) {
      if (
        !entry.cancelled &&
        entry.session &&
        matchesDesktopScreenSession(frame, entry.session, entry.sequence) &&
        frame.width === entry.session.width &&
        frame.height === entry.session.height
      ) {
        entry.sequence = frame.sequence
        entry.frame?.(frame)
        break
      }
    }
    return true
  }
  disconnected(): void {
    const entries = [...this.entries]
    this.entries.clear()
    for (const [id, entry] of entries) {
      this.removeRequest(id)
      if (!entry.cancelled) {
        entry.listener?.({ type: 'end', reason: 'disconnected' })
      }
    }
  }
}
