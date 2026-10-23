import React, { useEffect } from 'react'
import { X } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { DEFAULT_BOARD_CARD_STYLE, type BoardCardStyle } from './board-tool-style'
import { StrokeSections, TextSections } from './BoardStyleSections'
import { ToolPanelFrame } from './BoardToolPanelControls'
import { useCardStyleEditor } from './card-style-editor'

/** Style editor for one existing shape, stroke or text card (same controls as the tool panels). */
export function BoardCardStyleInspector(): React.JSX.Element | null {
  const target = useCardStyleEditor((s) => s.target)
  const close = useCardStyleEditor((s) => s.close)
  const card = useAppStore((s) =>
    target ? getBoard(s, target.worktreeId).cards.find((c) => c.id === target.cardId) : undefined
  )
  const editable = card && (card.kind === 'shape' || card.kind === 'stroke' || card.kind === 'text')

  // The card was deleted (or is not stylable): drop the editor.
  useEffect(() => {
    if (target && !editable) {
      close()
    }
  }, [close, editable, target])
  useEffect(() => {
    if (!target) {
      return
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, target])

  if (!target || !card || !editable) {
    return null
  }
  const style = card.style ?? DEFAULT_BOARD_CARD_STYLE
  const set = (patch: Partial<BoardCardStyle>): void =>
    useAppStore.getState().updateCard(target.worktreeId, card.id, { style: { ...style, ...patch } })
  const closed = card.kind === 'shape' && card.shape !== 'line' && card.shape !== 'arrow'
  const title = translate('board.style.title', 'Style: {{name}}', { name: card.title || card.kind })
  return (
    <ToolPanelFrame label={title}>
      <div className="flex items-center justify-between">
        <span className="truncate text-[13px] font-semibold text-[var(--board-text)]">{title}</span>
        <button
          type="button"
          aria-label={translate('board.style.close', 'Close style editor')}
          onClick={close}
          className="flex size-7 items-center justify-center rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)]"
        >
          <X className="size-4" />
        </button>
      </div>
      {card.kind === 'text' ? (
        <TextSections style={style} set={set} />
      ) : (
        <StrokeSections style={style} set={set} withFill={closed} withEdges={closed} />
      )}
    </ToolPanelFrame>
  )
}
