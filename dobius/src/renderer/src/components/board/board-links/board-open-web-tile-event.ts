// `boardOpenWebTile` event (`dobius board open-tile`): main validated the URL;
// the renderer adds exactly one web tile card per requestId at a free spot and
// returns the card id so main can wait for the tile's guest to register.
import { useAppStore } from '@/store'
import { getBoard, type BoardState } from '@/store/slices/board'
import type { RuntimeBoardOpenWebTileEvent } from '../../../../../shared/runtime-client-events'
import { BOARD_CHROME_INSETS } from '../board-canvas/board-reveal'
import { boardFreeSpawnCenter, boardSpawnPlacements } from '../board-canvas/board-spawn-placement'
import { screenToWorld, type BoardPoint } from '../board-canvas/board-viewport'

export const BOARD_WEB_TILE_SIZE = { w: 900, h: 600 }

export type BoardOpenWebTileOutcome = 'opened' | 'duplicate' | 'refused'
export type BoardOpenWebTileResult = { outcome: BoardOpenWebTileOutcome; cardId: string | null }

const HANDLED_LIMIT = 256
// Why: requestId → cardId, so a second delivery (window IPC after the client
// event) still answers main with the card that was already added.
const handled = new Map<string, string | null>()

function remember(requestId: string, cardId: string | null): void {
  handled.set(requestId, cardId)
  if (handled.size > HANDLED_LIMIT) {
    const oldest = handled.keys().next().value
    if (oldest !== undefined) {
      handled.delete(oldest)
    }
  }
}

function freeCenter(board: BoardState): BoardPoint {
  const v = board.viewport
  const inset = BOARD_CHROME_INSETS
  const topLeft = screenToWorld({ x: inset.left, y: inset.top }, v)
  const bottomRight = screenToWorld(
    { x: window.innerWidth - inset.right, y: window.innerHeight - inset.bottom },
    v
  )
  return boardFreeSpawnCenter(
    { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y },
    BOARD_WEB_TILE_SIZE,
    board.cards
  )
}

function httpUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

export function handleBoardOpenWebTileEvent(
  event: RuntimeBoardOpenWebTileEvent
): BoardOpenWebTileResult {
  const seen = handled.get(event.requestId)
  if (seen !== undefined) {
    return { outcome: 'duplicate', cardId: seen }
  }
  const url = httpUrl(event.url)
  if (!url) {
    console.warn('boardOpenWebTile refused: url must be http(s)', event.requestId)
    remember(event.requestId, null)
    return { outcome: 'refused', cardId: null }
  }
  const state = useAppStore.getState()
  const board = getBoard(state, event.worktreeId)
  const [position] = boardSpawnPlacements(freeCenter(board), 1, BOARD_WEB_TILE_SIZE)
  const cardId = state.addCard(event.worktreeId, {
    kind: 'web',
    title: event.title ?? url.hostname,
    url: url.toString(),
    ...position,
    ...BOARD_WEB_TILE_SIZE
  })
  remember(event.requestId, cardId)
  return { outcome: 'opened', cardId }
}

export function resetBoardOpenWebTileHandlerForTest(): void {
  handled.clear()
}
