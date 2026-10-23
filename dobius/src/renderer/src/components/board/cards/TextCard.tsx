import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { CardBodyProps } from './card-body-props'
import { boardFontFamily, boardInkCss, boardTextPx } from '../board-tool-panels/board-tool-style'

const LEGACY_TEXT_PX = 20
import { translate } from '@/i18n/i18n'

// Why: text cards render bare (drag anywhere), so the textarea only takes
// pointer input while editing; double-click enters edit mode.
export function TextCard({ card, onChange }: CardBodyProps<'text'>): React.JSX.Element {
  const [editing, setEditing] = useState(card.text === '')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing) {
      ref.current?.focus()
    }
  }, [editing])
  return (
    <div className="size-full" onDoubleClick={() => setEditing(true)}>
      <textarea
        ref={ref}
        aria-label={translate('board.text.label', 'Text')}
        data-board-card-control={editing ? '' : undefined}
        readOnly={!editing}
        value={card.text}
        onChange={(e) => onChange({ text: e.target.value })}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => e.key === 'Escape' && ref.current?.blur()}
        placeholder={translate('board.text.placeholder', 'Type something')}
        style={{
          fontSize: card.style ? boardTextPx(card.style.textSize) : LEGACY_TEXT_PX,
          textAlign: card.style?.textAlign ?? 'left',
          fontFamily: card.style ? boardFontFamily(card.style.textFont) : undefined,
          color: card.style ? boardInkCss(card.style.stroke) : 'var(--board-text)',
          opacity: card.style ? card.style.opacity / 100 : undefined
        }}
        className={cn(
          'size-full resize-none overflow-hidden border-0 bg-transparent leading-snug font-medium outline-none placeholder:text-[var(--board-text-muted)]',
          !editing && 'pointer-events-none select-none'
        )}
      />
    </div>
  )
}
