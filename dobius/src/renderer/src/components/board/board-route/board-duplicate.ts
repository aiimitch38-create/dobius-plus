import { getAgentLabel } from '@/lib/agent-catalog'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { launchBlankTerminalInNewTab } from '@/lib/launch-blank-terminal-in-new-tab'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import { BLANK_TERMINAL_OPTION_ID } from '../board-chrome/BoardAgentPicker'
import { agentOrDefault } from '../board-delivery/console-lifecycle'
import { duplicateCardDraft, duplicateSpot, nextConsoleTitle } from './board-duplicate-spot'
import { consoleTitleForTab } from './console-agent-title'

/**
 * Copies the given cards and returns the new ids. Plain cards land beside their
 * source on free canvas; consoles get a fresh agent (see duplicateConsole).
 */
export function duplicateBoardCards(worktreeId: string, cardIds: ReadonlySet<string>): string[] {
  const sources = getBoard(useAppStore.getState(), worktreeId).cards.filter((c) =>
    cardIds.has(c.id)
  )
  return sources.flatMap((card) => {
    if (card.kind === 'console') {
      return duplicateConsole(worktreeId, card) ?? []
    }
    // Why: read the board fresh so each copy also avoids the copies placed before it.
    const state = useAppStore.getState()
    const occupied = getBoard(state, worktreeId).cards
    return state.addCard(worktreeId, duplicateCardDraft(card, occupied))
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
  // Why: a 'blank' console has no TuiAgent to resolve — agentOrDefault would
  // otherwise silently fall back to Claude, turning a plain terminal copy
  // into an agent console. Handled as its own branch instead of threading a
  // nullable agent through the shared tail below.
  if (source.agentKind === BLANK_TERMINAL_OPTION_ID) {
    const launched = launchBlankTerminalInNewTab({ worktreeId })
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
      title: consoleTitleForTab(
        state,
        launched.tabId,
        nextConsoleTitle(
          translate('board.agentPicker.terminal', 'Terminal'),
          cards.flatMap((c) => (c.kind === 'console' ? [c.title] : []))
        )
      ),
      tabId: launched.tabId,
      agentKind: BLANK_TERMINAL_OPTION_ID,
      ...(source.role ? { role: source.role } : {})
    })
  }
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
    title: consoleTitleForTab(
      state,
      launched.tabId,
      nextConsoleTitle(
        getAgentLabel(agent),
        cards.flatMap((c) => (c.kind === 'console' ? [c.title] : []))
      )
    ),
    tabId: launched.tabId,
    agentKind: agent,
    ...(source.role ? { role: source.role } : {})
  })
}
