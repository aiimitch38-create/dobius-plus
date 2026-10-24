import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  BOARD_MENU_CONTENT_CLASS,
  BOARD_MENU_ROW_CLASS,
  BOARD_MENU_SEPARATOR_CLASS
} from '../board-chrome/board-surface-classes'
import type { CardBodyProps } from './card-body-props'
import { newItemId } from './card-body-props'
import { CardInlineAdd } from './card-inline-add'
import {
  KANBAN_COLUMN_ATTR,
  kanbanColumnAt,
  kanbanMoveTargets,
  moveKanbanItem
} from './kanban-card-moves'
import { translate } from '@/i18n/i18n'

// ponytail: native HTML5 drag between columns; the app's KanbanBoard is a full
// task system (people, IPC source) and doesn't fit a card's local columns.
export function KanbanCard({ card, onChange }: CardBodyProps<'kanban'>): React.JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const columnsRef = useRef(card.columns)
  columnsRef.current = card.columns
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const setColumns = (columns: typeof card.columns): void => onChange({ columns })
  const moveTo = (itemId: string, columnId: string): void => {
    const target = card.columns.find((c) => c.id === columnId)
    if (target) {
      setColumns(moveKanbanItem(card.columns, itemId, columnId, target.items.length))
    }
  }

  // Why: React's onDrop never fires here (see kanbanColumnAt), so the drop is
  // read on document in the capture phase while a drag from this card is live.
  useEffect(() => {
    if (!dragId) {
      return
    }
    const onDrop = (event: DragEvent): void => {
      const columnId = kanbanColumnAt(event.target, rootRef.current)
      if (columnId) {
        event.preventDefault()
        const target = columnsRef.current.find((c) => c.id === columnId)
        if (target) {
          onChangeRef.current({
            columns: moveKanbanItem(columnsRef.current, dragId, columnId, target.items.length)
          })
        }
      }
      setDragId(null)
      setOverColumn(null)
    }
    const onDragEnd = (): void => {
      setDragId(null)
      setOverColumn(null)
    }
    document.addEventListener('drop', onDrop, true)
    document.addEventListener('dragend', onDragEnd, true)
    return () => {
      document.removeEventListener('drop', onDrop, true)
      document.removeEventListener('dragend', onDragEnd, true)
    }
  }, [dragId])

  return (
    <div ref={rootRef} className="scrollbar-sleek flex size-full gap-2 overflow-x-auto p-3">
      {card.columns.map((column) => (
        <div
          key={column.id}
          {...{ [KANBAN_COLUMN_ATTR]: column.id }}
          className={cn(
            'flex w-44 shrink-0 flex-col gap-1.5 rounded-xl bg-[var(--board-panel-2)] p-2',
            overColumn === column.id && 'ring-2 ring-[var(--board-accent)]'
          )}
          onDragOver={(e) => {
            if (dragId) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setOverColumn(column.id)
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setOverColumn((c) => (c === column.id ? null : c))
            }
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
                  e.dataTransfer.effectAllowed = 'move'
                  setDragId(item.id)
                }}
                className={cn(
                  'group/item flex cursor-grab items-start gap-1 rounded-lg border border-[var(--board-panel-border)] bg-[var(--board-panel)] px-2 py-1.5 text-[13px]',
                  dragId === item.id && 'opacity-50'
                )}
              >
                <span className="min-w-0 flex-1 break-words">{item.text}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-board-card-control
                      aria-label={translate('board.kanban.itemActions', '{{name}} actions', {
                        name: item.text
                      })}
                      className="text-[var(--board-text-muted)] opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    side="bottom"
                    sideOffset={4}
                    data-surface="board"
                    className={BOARD_MENU_CONTENT_CLASS}
                  >
                    {kanbanMoveTargets(card.columns, item.id).map((target) => (
                      <DropdownMenuItem
                        key={target.id}
                        onSelect={() => moveTo(item.id, target.id)}
                        className={BOARD_MENU_ROW_CLASS}
                      >
                        {translate('board.kanban.moveTo', 'Move to {{column}}', {
                          column: target.title
                        })}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator className={BOARD_MENU_SEPARATOR_CLASS} />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() =>
                        setColumns(
                          card.columns.map((c) =>
                            c.id === column.id
                              ? { ...c, items: c.items.filter((i) => i.id !== item.id) }
                              : c
                          )
                        )
                      }
                      className={cn(
                        BOARD_MENU_ROW_CLASS,
                        'text-[var(--board-danger-text)] focus:text-[var(--board-danger-text)]'
                      )}
                    >
                      {translate('board.card.removeItem', 'Remove {{name}}', { name: item.text })}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
