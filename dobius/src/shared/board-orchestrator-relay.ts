// How a Board orchestrator card relays a typed message to its wired consoles.
// Shared so the card (renderer) and `dobius orchestration send --to board:<id>`
// (main) route and fan out the same way. Pure: no store, no IPC.

/** CLI/orchestration address of an orchestrator card: `board:<orchestratorCardId>`. */
export const BOARD_ORCHESTRATOR_ADDRESS_PREFIX = 'board:'

export type ScopedConsole = { cardId: string; title: string }

export type OrchestratorRoute =
  | { kind: 'all'; text: string }
  | { kind: 'one'; cardId: string; text: string }
  | {
      kind: 'refuse'
      reason: 'outside-scope' | 'ambiguous' | 'workspace' | 'undo' | 'nothing-wired'
    }

type RelayCard = { id: string; kind: string; tabId?: unknown; title?: unknown }

const WORKSPACE_ACTION =
  /^(open|new|create|close|rename|switch( to)?|go to)\s+(the\s+|a\s+)?(next\s+|previous\s+)?(workspace|board tab)\b/i
const UNDO_ACTION = /^(undo|redo)\b/i

/**
 * `@Name rest` targets one wired console (longest title match wins);
 * anything else goes to every wired console. Two wired consoles whose titles
 * match the mention (ignoring case) are refused: picking one would be a guess.
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
    const matchTitle = match.title.toLowerCase()
    if (wired.filter((c) => c.title.toLowerCase() === matchTitle).length > 1) {
      return { kind: 'refuse', reason: 'ambiguous' }
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

type ConsoleTerminal = {
  handle: string
  leafId: string
  connected: boolean
  ptyId: string | null
}
const isLiveTerminal = (t: ConsoleTerminal): boolean => t.connected && t.ptyId !== null

/**
 * Chooses which pane of a console card's tab is "the console". One live pane is
 * unambiguous. With several live panes only the tab's focused pane counts; if
 * that is not known the card is reported as unclear rather than guessed at.
 */
export function pickConsoleTerminal<T extends ConsoleTerminal>(
  inTab: T[],
  activeLeafId: string | null
): { terminal: T | null; running: boolean; paneUnclear: boolean } {
  const live = inTab.filter(isLiveTerminal)
  if (live.length === 0) {
    const shown = inTab.find((t) => t.leafId === activeLeafId) ?? inTab[0] ?? null
    return { terminal: shown, running: false, paneUnclear: false }
  }
  if (live.length === 1) {
    return { terminal: live[0], running: true, paneUnclear: false }
  }
  const focused = live.find((t) => t.leafId === activeLeafId)
  return focused
    ? { terminal: focused, running: true, paneUnclear: false }
    : { terminal: null, running: true, paneUnclear: true }
}

export type RelayTerminal = ConsoleTerminal & { tabId: string; originTabId?: string | null }
export type RelayTarget<T extends RelayTerminal> = { cardId: string; title: string; terminal: T }
export type RelaySkip = { cardId: string; title: string; reason: 'not-running' | 'pane-unclear' }

/**
 * The one live terminal of each wired console a relay reaches, narrowed to
 * `onlyCardIds` for an @mention. Same pane rule as `card:` addresses: a split
 * console gets it once (its focused pane), never in every pane; a stopped
 * console is skipped, not counted. Why wiring is passed in at send time: a
 * console disconnected meanwhile must get nothing.
 */
export function orchestratorRelayTargets<T extends RelayTerminal>(
  cards: readonly RelayCard[],
  wiredCardIds: readonly string[],
  onlyCardIds: readonly string[] | undefined,
  terminals: readonly T[],
  activeLeafIdOf: (tabId: string) => string | null
): { targets: RelayTarget<T>[]; skipped: RelaySkip[] } {
  const scope = new Set(
    onlyCardIds ? wiredCardIds.filter((id) => onlyCardIds.includes(id)) : wiredCardIds
  )
  const targets: RelayTarget<T>[] = []
  const skipped: RelaySkip[] = []
  const seen = new Set<string>()
  for (const card of cards) {
    if (card.kind !== 'console' || !scope.has(card.id) || typeof card.tabId !== 'string') {
      continue
    }
    const tabId = card.tabId
    const title = typeof card.title === 'string' ? card.title : ''
    // Why originTabId: while terminals are listed from PTY records the tab link lives there.
    const inTab = terminals.filter((t) => t.tabId === tabId || t.originTabId === tabId)
    const picked = pickConsoleTerminal(inTab, activeLeafIdOf(tabId))
    if (picked.paneUnclear) {
      skipped.push({ cardId: card.id, title, reason: 'pane-unclear' })
    } else if (!picked.running || !picked.terminal) {
      skipped.push({ cardId: card.id, title, reason: 'not-running' })
    } else if (!seen.has(picked.terminal.handle)) {
      seen.add(picked.terminal.handle)
      targets.push({ cardId: card.id, title, terminal: picked.terminal })
    }
  }
  return { targets, skipped }
}
