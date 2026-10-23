import { useState } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

// Enter-to-add input shared by checklist, kanban and calendar cards.
export function CardInlineAdd({
  placeholder,
  onAdd,
  className
}: {
  placeholder: string
  onAdd: (text: string) => void
  className?: string
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const submit = (): void => {
    const text = draft.trim()
    if (text) {
      onAdd(text)
      setDraft('')
    }
  }
  return (
    <div className={cn('flex items-center gap-1.5 text-[var(--board-text-muted)]', className)}>
      <Plus className="size-3.5 shrink-0" />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            submit()
          } else if (e.key === 'Escape') {
            setDraft('')
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[var(--board-text)] outline-none placeholder:text-[var(--board-text-muted)]"
      />
    </div>
  )
}
