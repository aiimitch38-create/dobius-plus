import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CardBodyProps } from './card-body-props'
import { newItemId } from './card-body-props'
import { CardInlineAdd } from './card-inline-add'
import { dateKey, monthGrid, shiftMonth } from './calendar-month'
import { translate } from '@/i18n/i18n'

// 2023-01-01 was a Sunday; format a week from it for locale-correct narrow weekday labels.
const weekdays = (): string[] =>
  Array.from({ length: 7 }, (_, i) =>
    new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' })
  )

export function CalendarCard({ card, onChange }: CardBodyProps<'calendar'>): React.JSX.Element {
  const today = dateKey(new Date())
  const [view, setView] = useState(() => ({
    year: new Date().getFullYear(),
    month: new Date().getMonth()
  }))
  const [selected, setSelected] = useState(today)
  const grid = useMemo(() => monthGrid(view.year, view.month), [view])
  const countByDay = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of card.events) {
      counts.set(e.date, (counts.get(e.date) ?? 0) + 1)
    }
    return counts
  }, [card.events])
  const dayEvents = card.events.filter((e) => e.date === selected)
  const label = new Date(view.year, view.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  })

  return (
    <div className="scrollbar-sleek flex size-full flex-col gap-2 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold">{label}</span>
        <div className="flex gap-0.5">
          {([-1, 1] as const).map((delta) => (
            <button
              key={delta}
              type="button"
              aria-label={
                delta < 0
                  ? translate('board.calendar.previousMonth', 'Previous month')
                  : translate('board.calendar.nextMonth', 'Next month')
              }
              onClick={() => setView((v) => shiftMonth(v.year, v.month, delta))}
              className="flex size-6 items-center justify-center rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)]"
            >
              {delta < 0 ? (
                <ChevronLeft className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
        {weekdays().map((d, i) => (
          <span key={i} className="font-semibold text-[var(--board-text-muted)]">
            {d}
          </span>
        ))}
        {grid.map((cell) => (
          <button
            key={cell.key}
            type="button"
            aria-label={cell.key}
            aria-pressed={cell.key === selected}
            onClick={() => setSelected(cell.key)}
            className={cn(
              'relative flex aspect-square items-center justify-center rounded-md text-[12px] hover:bg-[var(--board-panel-2)]',
              !cell.inMonth && 'text-[var(--board-text-muted)] opacity-60',
              cell.key === today && 'font-bold text-[var(--board-accent)]',
              cell.key === selected && 'bg-[var(--board-accent-tint)]'
            )}
          >
            {cell.day}
            {countByDay.has(cell.key) && (
              <span className="absolute bottom-0.5 size-1 rounded-full bg-[var(--board-accent)]" />
            )}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1 border-t border-[var(--board-panel-border)] pt-2">
        {dayEvents.map((event) => (
          <div key={event.id} className="group/item flex items-center gap-2 text-[13px]">
            <span className="size-1.5 shrink-0 rounded-full bg-[var(--board-accent)]" />
            <span className="min-w-0 flex-1 truncate">{event.title}</span>
            <button
              type="button"
              aria-label={translate('board.card.removeItem', 'Remove {{name}}', {
                name: event.title
              })}
              onClick={() => onChange({ events: card.events.filter((e) => e.id !== event.id) })}
              className="text-[var(--board-text-muted)] opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        <CardInlineAdd
          placeholder={translate('board.calendar.addEvent', 'Add event on {{date}}', {
            date: selected
          })}
          onAdd={(title) =>
            onChange({ events: [...card.events, { id: newItemId(), date: selected, title }] })
          }
        />
      </div>
    </div>
  )
}
