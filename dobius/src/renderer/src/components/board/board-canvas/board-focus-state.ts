// Focus-mode state on its own (no app store import) so card chrome can read it cheaply.
import { create } from 'zustand'
import type { BoardViewport } from './board-viewport'

export type BoardCameraFocus = {
  worktreeId: string
  /** The one focused card; null when a group or several cards are framed. */
  cardId: string | null
  /** Every card in focus (stays at full opacity); `[cardId]` for a single card. */
  cardIds: readonly string[]
  /** Set when a group frame is focused, so deleting the group ends focus mode. */
  groupId: string | null
  /** The viewport before focus mode began; Esc/Overview returns here exactly. */
  previous: BoardViewport
  /** Bumped when the camera lands, so the card flashes its ring once per arrival. */
  arrivedAt: number
}

export const useBoardCameraFocus = create<{ focus: BoardCameraFocus | null }>(() => ({
  focus: null
}))
