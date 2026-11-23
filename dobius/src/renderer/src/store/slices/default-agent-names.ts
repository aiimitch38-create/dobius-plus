import { pickAgentName } from '../../../../shared/agent-names'
import { TUI_AGENT_DISPLAY_NAMES } from '../../../../shared/tui-agent-display-names'
import type { TerminalTab, TuiAgent } from '../../../../shared/types'
import type { AppState } from '../types'
import type { BoardState } from './board-state'

// Why: tabs and console cards made before agent names existed still carry the
// old automatic defaults ("Terminal 3", "Claude 5"). They get a real name once,
// on load. Anything Carson typed (customTitle, a card title that is not an
// automatic default) is never touched.

const DEFAULT_TERMINAL_TITLE_RE = /^Terminal \d+$/

function isAutomaticTabName(tab: TerminalTab): boolean {
  if (tab.agentName?.trim() || tab.customTitle?.trim()) {
    return false
  }
  const defaultTitle = tab.defaultTitle?.trim()
  return !defaultTitle || DEFAULT_TERMINAL_TITLE_RE.test(defaultTitle)
}

/** "Claude 5" for a claude console, "Terminal 2" for any: the spawn-time default. */
export function isAutomaticConsoleTitle(title: string, agentKind: string): boolean {
  const match = /^(.+) \d+$/.exec(title.trim())
  if (!match) {
    return false
  }
  const label = match[1]
  return (
    label === 'Terminal' ||
    (agentKind in TUI_AGENT_DISPLAY_NAMES &&
      TUI_AGENT_DISPLAY_NAMES[agentKind as TuiAgent] === label)
  )
}

// Why seeded by tab id: a second load of the same (not yet re-saved) session
// must pick the same names, not reshuffle them.
function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  }
  let state = h >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Gives every hydrated tab that still has an automatic default name an agent
 * name, unique against every tab, manual rename and console card title.
 * Returns the input object when nothing changed.
 */
export function nameDefaultTerminalTabs(
  tabsByWorktree: Record<string, TerminalTab[]>,
  boardsByWorktree: Record<string, BoardState> | undefined
): Record<string, TerminalTab[]> {
  const used: string[] = []
  for (const tabs of Object.values(tabsByWorktree)) {
    for (const tab of tabs) {
      for (const label of [tab.agentName, tab.customTitle]) {
        if (label?.trim()) {
          used.push(label)
        }
      }
    }
  }
  for (const board of Object.values(boardsByWorktree ?? {})) {
    for (const card of board?.cards ?? []) {
      if (card.kind === 'console' && card.title?.trim()) {
        used.push(card.title)
      }
    }
  }
  let changed = false
  const next: Record<string, TerminalTab[]> = {}
  for (const worktreeId of Object.keys(tabsByWorktree).sort()) {
    next[worktreeId] = tabsByWorktree[worktreeId].map((tab) => {
      if (!isAutomaticTabName(tab)) {
        return tab
      }
      const agentName = pickAgentName(used, seededRandom(tab.id))
      used.push(agentName)
      changed = true
      return { ...tab, agentName }
    })
  }
  return changed ? { ...tabsByWorktree, ...next } : tabsByWorktree
}

/**
 * Console cards whose title is still an automatic default take their tab's
 * name (manual tab rename first, then agent name). Empty when nothing changes.
 */
export function defaultConsoleTitleRenames(
  boardsByWorktree: Record<string, BoardState>,
  // Why optional: a board-only store (tests, early hydration) has no tab slice.
  tabsByWorktree: Record<string, TerminalTab[]> | undefined
): { worktreeId: string; cardId: string; title: string }[] {
  const tabById = new Map<string, TerminalTab>()
  for (const tabs of Object.values(tabsByWorktree ?? {})) {
    for (const tab of tabs) {
      tabById.set(tab.id, tab)
    }
  }
  const renames: { worktreeId: string; cardId: string; title: string }[] = []
  for (const [worktreeId, board] of Object.entries(boardsByWorktree)) {
    for (const card of board?.cards ?? []) {
      if (card.kind !== 'console' || !isAutomaticConsoleTitle(card.title, card.agentKind)) {
        continue
      }
      const tab = tabById.get(card.tabId)
      const title = tab?.customTitle?.trim() || tab?.agentName?.trim()
      if (title && title !== card.title) {
        renames.push({ worktreeId, cardId: card.id, title })
      }
    }
  }
  return renames
}

/** Applies defaultConsoleTitleRenames once both boards and tabs are loaded. */
export function applyDefaultConsoleTitles(
  state: Pick<AppState, 'boardsHydrated' | 'boardsByWorktree' | 'tabsByWorktree' | 'updateCard'>
): void {
  if (!state.boardsHydrated) {
    return
  }
  for (const { worktreeId, cardId, title } of defaultConsoleTitleRenames(
    state.boardsByWorktree,
    state.tabsByWorktree
  )) {
    state.updateCard(worktreeId, cardId, { title })
  }
}
