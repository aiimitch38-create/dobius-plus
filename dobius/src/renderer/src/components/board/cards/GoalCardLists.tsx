import { useState } from 'react'
import { NotebookPen, X } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { BoardGoalCriterion, BoardGoalDont } from '@/store/slices/board'
import { newItemId } from './card-body-props'
import { CardInlineAdd } from './card-inline-add'

const ROW_INPUT_CLASS =
  'min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--board-text)] outline-none'
const ROW_ICON_BUTTON_CLASS =
  'text-[var(--board-text-muted)] opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100'

export function GoalSectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mt-1 text-[11px] font-semibold tracking-[0.05em] text-[var(--board-text-muted)] uppercase">
      {children}
    </div>
  )
}

function CriterionRow({
  item,
  onPatch,
  onRemove
}: {
  item: BoardGoalCriterion
  onPatch: (patch: Partial<BoardGoalCriterion>) => void
  onRemove: () => void
}): React.JSX.Element {
  const [noteOpen, setNoteOpen] = useState(Boolean(item.evidence))
  const noteLabel = translate('board.goal.evidence', 'Evidence (optional)')
  return (
    <div className="group/item rounded-md px-1 py-0.5 hover:bg-[var(--board-panel-2)]">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={item.done}
          aria-label={item.text}
          onCheckedChange={(checked) => onPatch({ done: checked === true })}
        />
        <input
          value={item.text}
          aria-label={translate('board.goal.criterionText', 'Done-means item')}
          onChange={(e) => onPatch({ text: e.target.value })}
          className={cn(
            ROW_INPUT_CLASS,
            item.done && 'text-[var(--board-text-muted)] line-through'
          )}
        />
        <button
          type="button"
          aria-label={noteLabel}
          aria-pressed={noteOpen}
          title={noteLabel}
          onClick={() => setNoteOpen((open) => !open)}
          className={cn(ROW_ICON_BUTTON_CLASS, item.evidence && 'opacity-100')}
        >
          <NotebookPen className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={translate('board.card.removeItem', 'Remove {{name}}', { name: item.text })}
          onClick={onRemove}
          className={ROW_ICON_BUTTON_CLASS}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {noteOpen ? (
        <input
          value={item.evidence ?? ''}
          placeholder={noteLabel}
          aria-label={noteLabel}
          onChange={(e) => onPatch({ evidence: e.target.value || undefined })}
          className="mt-0.5 ml-6 w-[calc(100%-1.5rem)] border-0 bg-transparent text-[12px] text-[var(--board-text-muted)] outline-none placeholder:text-[var(--board-text-muted)]"
        />
      ) : null}
    </div>
  )
}

export function GoalCriteriaList({
  criteria,
  onChange
}: {
  criteria: BoardGoalCriterion[]
  onChange: (criteria: BoardGoalCriterion[]) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      {criteria.map((item) => (
        <CriterionRow
          key={item.id}
          item={item}
          onPatch={(patch) =>
            onChange(criteria.map((c) => (c.id === item.id ? { ...c, ...patch } : c)))
          }
          onRemove={() => onChange(criteria.filter((c) => c.id !== item.id))}
        />
      ))}
      <CardInlineAdd
        className="px-1 py-0.5"
        placeholder={translate('board.goal.addCriterion', 'Add a done-means item')}
        onAdd={(text) => onChange([...criteria, { id: newItemId(), text, done: false }])}
      />
    </div>
  )
}

export function GoalDontList({
  items,
  onChange
}: {
  items: BoardGoalDont[]
  onChange: (items: BoardGoalDont[]) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => (
        <div
          key={item.id}
          className="group/item flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-[var(--board-panel-2)]"
        >
          <span aria-hidden className="text-[13px] text-[var(--board-text-muted)]">
            ×
          </span>
          <input
            value={item.text}
            aria-label={translate('board.goal.dontText', 'Out-of-scope item')}
            onChange={(e) =>
              onChange(items.map((d) => (d.id === item.id ? { ...d, text: e.target.value } : d)))
            }
            className={ROW_INPUT_CLASS}
          />
          <button
            type="button"
            aria-label={translate('board.card.removeItem', 'Remove {{name}}', { name: item.text })}
            onClick={() => onChange(items.filter((d) => d.id !== item.id))}
            className={ROW_ICON_BUTTON_CLASS}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <CardInlineAdd
        className="px-1 py-0.5"
        placeholder={translate('board.goal.addDont', 'Add something to stay out of')}
        onAdd={(text) => onChange([...items, { id: newItemId(), text }])}
      />
    </div>
  )
}
