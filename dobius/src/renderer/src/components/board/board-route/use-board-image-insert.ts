import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { BoardPoint } from '../board-canvas/board-viewport'
import { pruneBoardImages, saveBoardImage } from './board-image-assets'

/**
 * Image tool / "Insert image": one hidden file input; the picked file is stored
 * by reference (board-image-assets) and dropped as a card at the chosen point.
 */
export function useBoardImageInsert(
  worktreeId: string | null,
  onInserted: () => void
): {
  inputRef: React.RefObject<HTMLInputElement | null>
  pickAt: (world: BoardPoint) => void
  onPicked: (file: File | undefined) => void
} {
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingAt = useRef<BoardPoint | null>(null)

  // Drop stored image bytes no card points at any more (deleted cards, closed boards).
  const boardsHydrated = useAppStore((s) => s.boardsHydrated)
  useEffect(() => {
    if (!boardsHydrated) {
      return
    }
    const referenced = new Set(
      Object.values(useAppStore.getState().boardsByWorktree).flatMap((b) =>
        b.cards.flatMap((c) => (c.kind === 'image' ? [c.src] : []))
      )
    )
    pruneBoardImages(referenced).catch((error: unknown) =>
      console.warn('Board image cleanup failed:', error)
    )
  }, [boardsHydrated])

  const pickAt = (world: BoardPoint): void => {
    pendingAt.current = world
    inputRef.current?.click()
  }

  const onPicked = (file: File | undefined): void => {
    const at = pendingAt.current
    pendingAt.current = null
    if (!file || !at || !worktreeId) {
      return
    }
    saveBoardImage(file)
      .then((src) => {
        useAppStore.getState().addCard(worktreeId, {
          kind: 'image',
          title: file.name,
          x: at.x - 160,
          y: at.y - 120,
          w: 320,
          h: 240,
          src
        })
        onInserted()
      })
      .catch((error: unknown) => {
        console.warn('Board image save failed:', error)
        toast.error(translate('board.image.readFailed', 'Could not read that image.'))
      })
  }

  return { inputRef, pickAt, onPicked }
}
