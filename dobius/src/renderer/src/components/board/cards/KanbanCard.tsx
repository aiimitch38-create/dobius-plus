import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CardBodyProps } from './card-body-props'
import { newItemId } from './card-body-props'
import { CardInlineAdd } from './card-inline-add'
import { moveKanbanItem } from './kanban-card-moves'
import { translate } from '@/i18n/i18n'

// ponytail: native HTML5 drag between columns; the app's KanbanBoard is a full
// task system (people, IPC source) and doesn't fit a card's local columns.
export function KanbanCard({ card, onChange }: CardBodyProps<'kanban'>): React.JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<string | null>(null)
  const setColumns = (columns: typeof card.columns): void => onChange({ columns })

  return (
    <div className="scrollbar-sleek flex size-full gap-2 overflow-x-auto p-3">
      {card.columns.map((column) => (
        <div
          key={column.id}
          className={cn(
            'flex w-44 shrink-0 flex-col gap-1.5 rounded-xl bg-[var(--board-panel-2)] p-2',
            overColumn === column.id && 'ring-2 ring-[var(--board-accent)]'
          )}
          onDragOver={(e) => {
            if (dragId) {
              e.preventDefault()
              setOverColumn(column.id)
            }
          }}
          onDragLeave={() => setOverColumn(null)}
          onDrop={(e) => {
            e.preventDefault()
            if (dragId) {
              setColumns(moveKanbanItem(card.columns, dragId, column.id, column.items.length))
            }
            setDragId(null)
            setOverColumn(null)
          }}
        >
          <div className="flex items-center justify-between px-1 text-[11px] font-semibold tracking-[0.05em] text-[var(--board-text-muted)] uppercase">
            <span className="truncate">{column.title}</span>
            <span>{column.items.length}</span>
          </div>
          <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            {column.items.map((item) => (
              <div
                key={item.id}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation()
                  setDragId(item.id)
                }}
                onDragEnd={() => setDragId(null)}
                className={cn(
                  'group/item flex cursor-grab items-start gap-1 rounded-lg border border-[var(--board-panel-border)] bg-[var(--board-panel)] px-2 py-1.5 text-[13px]',
                  dragId === item.id && 'opacity-50'
                )}
              >
                <span className="min-w-0 flex-1 break-words">{item.text}</span>
                <button
                  type="button"
                  aria-label={translate('board.card.removeItem', 'Remove {{name}}', {
                    name: item.text
                  })}
                  onClick={() =>
                    setColumns(
                      card.columns.map((c) =>
                        c.id === column.id
                          ? { ...c, items: c.items.filter((i) => i.id !== item.id) }
                          : c
                      )
                    )
                  }
                  className="text-[var(--board-text-muted)] opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <CardInlineAdd
            className="px-1"
            placeholder={translate('board.kanban.add', 'Add a card')}
            onAdd={(text) =>
              setColumns(
                card.columns.map((c) =>
                  c.id === column.id ? { ...c, items: [...c.items, { id: newItemId(), text }] } : c
                )
              )
            }
          />
        </div>
      ))}
    </div>
  )
}
