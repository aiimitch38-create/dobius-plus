// Tiny pub/sub between the IPC layer (useIpcEvents) and the agent-presence
// store: main sends `ui:agentCursor`, the inbox fans it out to subscribers.
// Owned by the transport lane; the presence store subscribes with
// `subscribeAgentCursor` and never touches IPC directly.
import type { AgentCursorEvent } from '../../../../../shared/agent-cursor'

type Listener = (event: AgentCursorEvent) => void

const listeners = new Set<Listener>()

/** Subscribe to agent cursor events; returns the unsubscribe function. */
export function subscribeAgentCursor(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Called by useIpcEvents for every `ui:agentCursor` message. */
export function handleAgentCursorEvent(event: AgentCursorEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error('agent cursor listener failed:', error)
    }
  }
}

export function resetAgentCursorInboxForTest(): void {
  listeners.clear()
}
