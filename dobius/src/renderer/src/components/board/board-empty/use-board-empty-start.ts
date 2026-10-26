import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../../../shared/types'
import { boardSpawnBlockSize } from '../board-canvas/board-spawn-placement'
import type { BoardPoint } from '../board-canvas/board-viewport'
import type { BoardStudioId } from '../board-studios/board-studio-ids'
import type { BoardRouteData } from '../board-route/use-board-route-data'
import type { BoardEmptyStartProps } from './BoardEmptyStart'
import {
  boardEmptyStartSelection,
  selectBoardEmptyStartAgent,
  shouldShowBoardEmptyStart,
  useBoardEmptyStartDismissed
} from './board-empty-start'

type UseBoardEmptyStartInput = {
  data: BoardRouteData
  /** The picker's spawn: same path as "New console" / "Spawn 4" (use-board-actions). */
  spawn: (agent: TuiAgent, count: number, center: BoardPoint) => void
  freeCenter: (size: { w: number; h: number }) => BoardPoint
  openStudio: (studio: BoardStudioId) => void
  suspended: boolean
}

/**
 * Props for the empty-board start card, or null while it should not show.
 * Spawns, the default-agent setting and the Presets studio all reuse the
 * paths the command-bar chips and Settings > Agents already use.
 */
export function useBoardEmptyStart({
  data,
  spawn,
  freeCenter,
  openStudio,
  suspended
}: UseBoardEmptyStartInput): BoardEmptyStartProps | null {
  const { worktreeId, board, agents } = data
  const hydrated = useAppStore((s) => s.boardsHydrated)
  const defaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  const dismissed = useBoardEmptyStartDismissed(
    (s) => worktreeId !== null && s.dismissed[worktreeId] === true
  )
  if (
    !worktreeId ||
    !shouldShowBoardEmptyStart({ hydrated, worktreeId, cardCount: board.cards.length, dismissed })
  ) {
    return null
  }
  return {
    agents,
    selected: boardEmptyStartSelection(defaultAgent, agents),
    onSelect: selectBoardEmptyStartAgent,
    onSpawn: (agent, count) => spawn(agent, count, freeCenter(boardSpawnBlockSize(count))),
    onPreset: () => openStudio('presets'),
    onDismiss: () => useBoardEmptyStartDismissed.getState().dismiss(worktreeId),
    suspended
  }
}
