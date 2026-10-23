// Why: Reply-to lives on cards and in the output viewer, far from the command
// bar's controlled draft in BoardRoute; a tiny pub/sub avoids threading a
// callback through every card renderer.
type Listener = (text: string) => void

const listeners = new Set<Listener>()

/** The draft that addresses one console: "@Name " (the mention parser accepts spaces). */
export function boardReplyDraft(consoleName: string): string {
  return `@${consoleName.trim()} `
}

export function requestCommandBarPrefill(text: string): void {
  for (const listener of listeners) {
    listener(text)
  }
}

export function onCommandBarPrefill(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
