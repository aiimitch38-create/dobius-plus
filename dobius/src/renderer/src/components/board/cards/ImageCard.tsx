import { Eraser } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import { strokeIdsOver } from './board-card-extras'

export function ImageCard({
  card,
  worktreeId
}: {
  card: BoardCardOf<'image'>
  worktreeId: string
}): React.JSX.Element {
  const markCount = useAppStore((s) => strokeIdsOver(getBoard(s, worktreeId), card).length)
  return (
    <div className="group relative size-full">
      <img
        src={card.src}
        alt={card.title}
        draggable={false}
        className="size-full rounded-(--board-radius-card) object-contain select-none"
      />
      {markCount > 0 ? (
        // Pen strokes over the image are its annotation layer; this clears them in one go.
        <button
          type="button"
          onClick={() =>
            useAppStore
              .getState()
              .removeCards(
                worktreeId,
                strokeIdsOver(getBoard(useAppStore.getState(), worktreeId), card)
              )
          }
          className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-[var(--board-panel)] px-2 py-1 text-[11px] text-[var(--board-text)] opacity-0 shadow group-hover:opacity-100"
        >
          <Eraser className="size-3" />
          {translate('board.image.clearMarks', 'Clear marks ({{count}})', { count: markCount })}
        </button>
      ) : null}
    </div>
  )
}
