import { X } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { CardBodyProps } from './card-body-props'
import { newItemId } from './card-body-props'
import { CardInlineAdd } from './card-inline-add'
import { translate } from '@/i18n/i18n'

export function ChecklistCard({ card, onChange }: CardBodyProps<'checklist'>): React.JSX.Element {
  const done = card.items.filter((i) => i.done).length
  const setItems = (items: typeof card.items): void => onChange({ items })
  return (
    <div className="scrollbar-sleek flex size-full flex-col gap-1 overflow-y-auto p-3">
      {card.items.length > 0 && (
        <div className="mb-1 text-[11px] font-semibold tracking-[0.05em] text-[var(--board-text-muted)] uppercase">
          {translate('board.checklist.progress', '{{done}}/{{total}} done', {
            done,
            total: card.items.length
          })}
        </div>
      )}
      {card.items.map((item) => (
        <div
          key={item.id}
          className="group/item flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-[var(--board-panel-2)]"
        >
          <Checkbox
            checked={item.done}
            aria-label={item.text}
            onCheckedChange={(checked) =>
              setItems(
                card.items.map((i) => (i.id === item.id ? { ...i, done: checked === true } : i))
              )
            }
          />
          <input
            value={item.text}
            aria-label={translate('board.checklist.itemText', 'Item text')}
            onChange={(e) =>
              setItems(
                card.items.map((i) => (i.id === item.id ? { ...i, text: e.target.value } : i))
              )
            }
            className={cn(
              'min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--board-text)] outline-none',
              item.done && 'text-[var(--board-text-muted)] line-through'
            )}
          />
          <button
            type="button"
            aria-label={translate('board.card.removeItem', 'Remove {{name}}', { name: item.text })}
            onClick={() => setItems(card.items.filter((i) => i.id !== item.id))}
            className="text-[var(--board-text-muted)] opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <CardInlineAdd
        className="px-1 py-0.5"
        placeholder={translate('board.checklist.add', 'Add a to-do')}
        onAdd={(text) => setItems([...card.items, { id: newItemId(), text, done: false }])}
      />
    </div>
  )
}
