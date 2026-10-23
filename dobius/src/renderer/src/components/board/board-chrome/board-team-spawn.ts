import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { BOARD_CONSOLE_SIZE, boardSpawnPlacements } from '../board-canvas/board-spawn-placement'
import type { BoardPoint } from '../board-canvas/board-viewport'
import { spawnConsoles } from '../board-delivery/console-lifecycle'
import { groupBoardCards } from '../board-route/board-groupable'
import type { TeamSlot } from './team-composer'

/**
 * Spawns one console per slot (its agent and role) as a block at `center`,
 * then frames them as one group. No brief is typed: each agent starts empty.
 */
export function spawnTeamOnBoard(
  worktreeId: string | null,
  slots: readonly TeamSlot[],
  center: BoardPoint
): string[] {
  if (!worktreeId) {
    toast.error(translate('board.spawn.noWorkspace', 'Open a workspace before spawning consoles.'))
    return []
  }
  const cardIds: string[] = []
  let failed = 0
  boardSpawnPlacements(center, slots.length).forEach((position, i) => {
    const slot = slots[i]
    const result = spawnConsoles({
      worktreeId,
      agent: slot.agent,
      count: 1,
      brief: null,
      role: slot.role,
      center: {
        x: position.x + BOARD_CONSOLE_SIZE.w / 2,
        y: position.y + BOARD_CONSOLE_SIZE.h / 2
      }
    })
    cardIds.push(...result.cardIds)
    failed += result.failed
  })
  if (failed > 0) {
    toast.error(
      translate('board.spawn.partial', '{{failed}} of {{count}} consoles did not start.', {
        failed,
        count: slots.length
      })
    )
  }
  groupBoardCards(worktreeId, new Set(cardIds))
  return cardIds
}
