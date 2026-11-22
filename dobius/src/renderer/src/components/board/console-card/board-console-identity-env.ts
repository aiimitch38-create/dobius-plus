import type { BoardSlice } from '@/store/slices/board'

export const BOARD_CARD_TITLE_ENV_MAX_CHARS = 200

/**
 * Why: a Board console could not tell which card it was, so agents guessed
 * their own address. These three names let a console say "I am card X on board
 * Y" and let others reach it with `dobius board send --card`. Boards are keyed
 * by worktree, so the board id is the worktree id. A tab with no console card
 * gets nothing: a plain terminal must not claim a card identity. The card id
 * is the address; the title is shortened for display and can repeat.
 * Known gap: a console launched on a paired web runtime is created on the host
 * before its card exists (createWebRuntimeSessionTerminal, then
 * awaitMirroredConsoleTabs binds the card), so it gets none of these.
 */
export function boardConsoleIdentityEnv(
  state: Pick<BoardSlice, 'boardsByWorktree'>,
  worktreeId: string,
  tabId: string
): Record<string, string> {
  // Why: every PTY spawn runs through here, including before boards hydrate.
  const cards = state.boardsByWorktree?.[worktreeId]?.cards ?? []
  const card = cards.find(
    (candidate) => candidate.kind === 'console' && candidate.tabId === tabId
  )
  if (!card) {
    return {}
  }
  // Why: env values travel through shells and WSLENV; keep the title one line.
  const title = (card.title ?? '')
    .replace(/\p{Cc}+/gu, ' ')
    .trim()
    .slice(0, BOARD_CARD_TITLE_ENV_MAX_CHARS)
  return {
    DOBIUS_BOARD_ID: worktreeId,
    DOBIUS_BOARD_CARD_ID: card.id,
    ...(title ? { DOBIUS_BOARD_CARD_TITLE: title } : {})
  }
}
