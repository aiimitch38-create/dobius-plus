// How a Board orchestrator card relays a typed message to its wired consoles.
// Shared so the card (renderer) and `dobius orchestration send --to board:<id>`
// (main) route and fan out the same way. Pure: no store, no IPC.

/** CLI/orchestration address of an orchestrator card: `board:<orchestratorCardId>`. */
export const BOARD_ORCHESTRATOR_ADDRESS_PREFIX = 'board:'

export type ScopedConsole = { cardId: string; title: string }

export type OrchestratorRoute =
  | { kind: 'all'; text: string }
  | { kind: 'one'; cardId: string; text: string }
  | { kind: 'refuse'; reason: 'outside-scope' | 'workspace' | 'undo' | 'nothing-wired' }

type RelayCard = { id: string; kind: string; tabId?: unknown; title?: unknown }

const WORKSPACE_ACTION =
  /^(open|new|create|close|rename|switch( to)?|go to)\s+(the\s+|a\s+)?(next\s+|previous\s+)?(workspace|board tab)\b/i
const UNDO_ACTION = /^(undo|redo)\b/i

/**
 * `@Name rest` targets one wired console (longest title match wins);
 * anything else goes to every wired console.
 */
export function routeOrchestratorMessage(
  raw: string,
  wired: readonly ScopedConsole[]
): OrchestratorRoute {
  const text = raw.trim()
  if (WORKSPACE_ACTION.test(text)) {
    return { kind: 'refuse', reason: 'workspace' }
  }
  if (UNDO_ACTION.test(text)) {
    return { kind: 'refuse', reason: 'undo' }
  }
  if (text.startsWith('@')) {
    const after = text.slice(1).toLowerCase()
    const match = [...wired]
      .sort((a, b) => b.title.length - a.title.length)
      .find((c) => {
        const title = c.title.toLowerCase()
        return (
          after.startsWith(title) &&
          (after.length === title.length || /\s/.test(after[title.length]))
        )
      })
    if (!match) {
      return { kind: 'refuse', reason: 'outside-scope' }
    }
    const body = text.slice(1 + match.title.length).trim()
    return body
      ? { kind: 'one', cardId: match.cardId, text: body }
      : { kind: 'refuse', reason: 'outside-scope' }
  }
  return wired.length === 0 ? { kind: 'refuse', reason: 'nothing-wired' } : { kind: 'all', text }
}

/** The card's own mailbox handle; replies to its messages land here. */
export function orchestratorHandle(cardId: string): string {
  return `board-orchestrator:${cardId}`
}

/** Subject line for the message list: the first line, bounded. */
export function relaySubject(text: string): string {
  const first = text.trim().split('\n')[0] ?? ''
  return first.length > 80 ? `${first.slice(0, 79)}…` : first
}

/** Thread id one relayed message shares across its recipients. */
export function relayThreadId(cardId: string, now: number): string {
  return `board_${cardId}_${now}`
}

/** Wired cards that are still consoles on this board, with their titles (for @Name routing). */
export function wiredScopedConsoles(
  cards: readonly RelayCard[],
  wiredCardIds: readonly string[]
): ScopedConsole[] {
  const wired = new Set(wiredCardIds)
  return cards.flatMap((c) =>
    c.kind === 'console' && wired.has(c.id)
      ? [{ cardId: c.id, title: typeof c.title === 'string' ? c.title : '' }]
      : []
  )
}

/** Tab ids of wired cards that are still consoles on this board. */
export function wiredConsoleTabIds(
  cards: readonly RelayCard[],
  wiredCardIds: readonly string[]
): string[] {
  const wired = new Set(wiredCardIds)
  return cards.flatMap((c) =>
    c.kind === 'console' && wired.has(c.id) && typeof c.tabId === 'string' ? [c.tabId] : []
  )
}

/**
 * Terminals one relay reaches: those in the tabs of the wired consoles, narrowed
 * to `onlyCardIds` for an @mention. Why wiring is passed in at send time: a
 * console disconnected meanwhile must get nothing.
 */
export function orchestratorRelayRecipients<T extends { tabId: string }>(
  cards: readonly RelayCard[],
  wiredCardIds: readonly string[],
  onlyCardIds: readonly string[] | undefined,
  terminals: readonly T[]
): T[] {
  const scope = onlyCardIds ? wiredCardIds.filter((id) => onlyCardIds.includes(id)) : wiredCardIds
  const tabIds = new Set(wiredConsoleTabIds(cards, scope))
  return terminals.filter((t) => tabIds.has(t.tabId))
}
