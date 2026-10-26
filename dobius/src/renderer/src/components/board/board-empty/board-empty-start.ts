// Empty-board start panel: when a board has no cards, a centered card offers a
// default model and one-click spawns. Pure rules live here; the panel renders them.
import { create } from 'zustand'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../../../shared/types'
import type { BoardAgentOption } from '../board-chrome/BoardAgentPicker'

/** The five tiles the reference shows; "More" lists every other launchable agent. */
export const BOARD_EMPTY_START_TILES: readonly TuiAgent[] = [
  'claude',
  'codex',
  'gemini',
  'grok',
  'opencode'
]

/** Spawn counts behind "or spawn several". */
export const BOARD_EMPTY_START_COUNTS: readonly number[] = [2, 4, 8]

export type BoardEmptyStartVisibility = {
  hydrated: boolean
  worktreeId: string | null
  cardCount: number
  dismissed: boolean
}

/**
 * Shown only for an open, hydrated board with zero cards that was not closed.
 * Why: before hydration every board reads as empty, which would flash the
 * panel over boards that are about to fill in.
 */
export function shouldShowBoardEmptyStart({
  hydrated,
  worktreeId,
  cardCount,
  dismissed
}: BoardEmptyStartVisibility): boolean {
  return hydrated && worktreeId !== null && cardCount === 0 && !dismissed
}

/**
 * The tile to show selected: the default agent setting when it is launchable
 * here, else the first launchable agent (the route already orders the default
 * first), else null when nothing can be launched.
 */
export function boardEmptyStartSelection(
  defaultAgent: TuiAgent | 'blank' | null | undefined,
  agents: readonly BoardAgentOption[]
): TuiAgent | null {
  if (defaultAgent && defaultAgent !== 'blank' && agents.some((a) => a.id === defaultAgent)) {
    return defaultAgent
  }
  return agents[0]?.id ?? null
}

/** A tile pick is the same setting Settings > Agents writes (AgentsPane "default"). */
export function selectBoardEmptyStartAgent(agent: TuiAgent): void {
  void useAppStore.getState().updateSettings({ defaultTuiAgent: agent })
}

/** Launchable agents that have no tile of their own (the "More" list). */
export function boardEmptyStartMoreAgents(agents: readonly BoardAgentOption[]): BoardAgentOption[] {
  return agents.filter((a) => !BOARD_EMPTY_START_TILES.includes(a.id))
}

type BoardEmptyStartDismissed = {
  dismissed: Record<string, true>
  dismiss: (worktreeId: string) => void
}

// Why: × hides the panel for that board until the app reloads; no board flag
// exists for one-off UI chrome, so this stays in memory, keyed by worktree.
export const useBoardEmptyStartDismissed = create<BoardEmptyStartDismissed>((set) => ({
  dismissed: {},
  dismiss: (worktreeId) => set((s) => ({ dismissed: { ...s.dismissed, [worktreeId]: true } }))
}))
