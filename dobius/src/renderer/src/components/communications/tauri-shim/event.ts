/**
 * Stand-in for `@tauri-apps/api/event`, backed by a renderer-local event bus.
 *
 * Tauri's event system spanned processes; every emitter and listener in the
 * restored tree lives in this one renderer, so a local bus is behaviourally
 * equivalent here. Main-process pushes arrive over IPC and can be re-emitted
 * onto this bus at the call site that owns them.
 */
export type UnlistenFn = () => void
export type Event<T> = { event: string; id: number; payload: T }
export type EventCallback<T> = (event: Event<T>) => void

const listeners = new Map<string, Set<EventCallback<unknown>>>()
let nextId = 1

export async function listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  const set = listeners.get(event) ?? new Set()
  set.add(handler as EventCallback<unknown>)
  listeners.set(event, set)
  return () => {
    set.delete(handler as EventCallback<unknown>)
  }
}

export async function once<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  const unlisten = await listen<T>(event, (payload) => {
    unlisten()
    handler(payload)
  })
  return unlisten
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  const set = listeners.get(event)
  if (!set) {
    return
  }
  const id = nextId++
  for (const handler of [...set]) {
    handler({ event, id, payload })
  }
}
