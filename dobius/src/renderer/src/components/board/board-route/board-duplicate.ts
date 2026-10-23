import { getAgentLabel } from '@/lib/agent-catalog'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf, type NewBoardCard } from '@/store/slices/board'
import { agentOrDefault } from '../board-delivery/console-lifecycle'
import { duplicateSpot, nextConsoleTitle } from './board-duplicate-spot'

const DUPLICATE_OFFSET = 24

/**
 * Copies the given cards and returns the new ids. Plain cards land 24px
 * down-right; consoles get a fresh agent (see duplicateConsole).
 */
export function duplicateBoardCards(worktreeId: string, cardIds: ReadonlySet<string>): string[] {
  const store = useAppStore.getState()
  return getBoard(store, worktreeId)
    .cards.filter((c) => cardIds.has(c.id))
    .flatMap((card) => {
      if (card.kind === 'console') {
        return duplicateConsole(worktreeId, card) ?? []
      }
      const { id: _id, z: _z, ...rest } = card
      return store.addCard(worktreeId, {
        ...rest,
        x: card.x + DUPLICATE_OFFSET,
        y: card.y + DUPLICATE_OFFSET
      } as NewBoardCard)
    })
}

/**
 * A new console like `source`: same agent kind, role and size, in a new tab,
 * placed beside it. Why a new tab: a card points at one live terminal, so the
 * PTY is never shared or copied. Permission-skipping (yolo) is not carried
 * over; the copy launches with the normal prompts. Returns null when the agent
 * could not be launched.
 */
export function duplicateConsole(
  worktreeId: string,
  source: BoardCardOf<'console'>
): string | null {
  const agent = agentOrDefault(source.agentKind)
  const launched = launchAgentInNewTab({ agent, worktreeId, launchSource: 'unknown' })
  if (!launched?.tabId) {
    return null
  }
  const state = useAppStore.getState()
  const cards = getBoard(state, worktreeId).cards
  const position = duplicateSpot(source, cards)
  return state.addCard(worktreeId, {
    kind: 'console',
    ...position,
    w: source.w,
    h: source.h,
    title: nextConsoleTitle(
      getAgentLabel(agent),
      cards.flatMap((c) => (c.kind === 'console' ? [c.title] : []))
    ),
    tabId: launched.tabId,
    agentKind: agent,
    ...(source.role ? { role: source.role } : {})
  })
}
