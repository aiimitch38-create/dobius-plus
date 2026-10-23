// "Add to board" from the Code and Markdown studios: a file card at the centre
// of what the user is looking at, offset per drop so repeats don't stack exactly.
import { useAppStore } from '@/store'
import { getBoard, type NewBoardCard } from '@/store/slices/board'
import { screenToWorld, type BoardPoint } from '../board-canvas/board-viewport'

const FILE_CARD_W = 560
const FILE_CARD_H = 640
const CASCADE_STEP = 28
const CASCADE_SLOTS = 6

/** Markdown card for `filePath` centred on `center` (world coords). */
export function boardFileCard(
  filePath: string,
  center: BoardPoint,
  existingFileCards: number
): NewBoardCard {
  const offset = (existingFileCards % CASCADE_SLOTS) * CASCADE_STEP
  return {
    kind: 'markdown',
    title: filePath.split(/[\\/]/).pop() || filePath,
    path: filePath,
    x: center.x - FILE_CARD_W / 2 + offset,
    y: center.y - FILE_CARD_H / 2 + offset,
    w: FILE_CARD_W,
    h: FILE_CARD_H
  }
}

/** Adds the card to the worktree's board and brings it to the front; returns its id. */
export function addFileCardToBoard(worktreeId: string, filePath: string): string {
  const state = useAppStore.getState()
  const board = getBoard(state, worktreeId)
  const center = screenToWorld(
    { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    board.viewport
  )
  const existing = board.cards.filter((c) => c.kind === 'markdown').length
  const id = state.addCard(worktreeId, boardFileCard(filePath, center, existing))
  state.bringToFront(worktreeId, [id])
  return id
}
