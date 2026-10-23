import { deliverOrder } from '../board-delivery/board-delivery'
import type { DeliveryOutcome } from '../board-delivery/delivery-gate'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf, type BoardState } from '@/store/slices/board'
import type { MemoryPushOutcome } from '../board-studios/memory-entries'

export type MemoryPushCounts = Record<MemoryPushOutcome, number>

/** Console cards a memory card reaches: wired consoles plus members of wired groups, once each. */
export function memoryPushTargets(
  board: BoardState,
  wiredIds: readonly string[]
): BoardCardOf<'console'>[] {
  const wired = new Set(wiredIds)
  const viaGroups = new Set(board.groups.filter((g) => wired.has(g.id)).flatMap((g) => g.cardIds))
  return board.cards.filter(
    (c): c is BoardCardOf<'console'> =>
      c.kind === 'console' && (wired.has(c.id) || viaGroups.has(c.id))
  )
}

export function emptyPushCounts(): MemoryPushCounts {
  return { sent: 0, busy: 0, shell: 0, failed: 0 }
}

/** Types `brief` into every target through the Board delivery queue (never into shells). */
export async function pushMemoryToConsoles(
  worktreeId: string,
  wiredIds: readonly string[],
  brief: string
): Promise<MemoryPushCounts> {
  const counts = emptyPushCounts()
  const targets = memoryPushTargets(getBoard(useAppStore.getState(), worktreeId), wiredIds)
  if (targets.length === 0) {
    return counts
  }
  const { outcomes } = await deliverOrder({
    worktreeId,
    summary: brief,
    lanes: targets.map((c) => ({ tabId: c.tabId, name: c.title, text: brief }))
  })
  for (const { outcome } of outcomes) {
    counts[pushOutcome(outcome)] += 1
  }
  return counts
}

function pushOutcome(outcome: DeliveryOutcome): MemoryPushOutcome {
  if (outcome.kind === 'sent') {
    return outcome.busy ? 'busy' : 'sent'
  }
  return outcome.kind === 'skipped' && outcome.reason === 'shell' ? 'shell' : 'failed'
}
