import { useState } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import type { CardBodyProps } from './card-body-props'
import { swatchFill } from './card-swatch'
import { notePushTargets, pushNoteToConsole } from './note-push'

function NotePushMenu({
  worktreeId,
  text
}: {
  worktreeId: string
  text: string
}): React.JSX.Element {
  const targets = notePushTargets(useAppStore((s) => getBoard(s, worktreeId)))
  const [sending, setSending] = useState(false)
  const push = async (tabId: string, title: string): Promise<void> => {
    setSending(true)
    try {
      const error = await pushNoteToConsole(worktreeId, tabId, text)
      if (error) {
        toast.error(error)
      } else {
        toast.success(translate('board.note.pushed', 'Sent to {{name}}', { name: title }))
      }
    } finally {
      setSending(false)
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={sending || !text.trim()}
          className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-[var(--board-text)] hover:bg-[var(--board-panel)] disabled:opacity-40"
        >
          <Send className="size-3.5" />
          {translate('board.note.push', 'Push')}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          {translate('board.note.pushTo', 'Send this note to')}
        </DropdownMenuLabel>
        {targets.length === 0 ? (
          <div className="px-2 py-1 text-[12px] text-muted-foreground">
            {translate('board.orchestrator.noConsoles', 'No consoles on this board.')}
          </div>
        ) : (
          targets.map((t) => (
            <DropdownMenuItem key={t.cardId} onSelect={() => void push(t.tabId, t.title)}>
              {t.title}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function NoteCard({
  card,
  onChange,
  worktreeId
}: CardBodyProps<'note'> & { worktreeId: string }): React.JSX.Element {
  return (
    <div className="flex size-full flex-col" style={{ background: swatchFill(card.color) }}>
      <textarea
        aria-label={translate('board.note.text', '{{title}} text', { title: card.title })}
        value={card.text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder={translate('board.note.placeholder', 'Write a note')}
        className="min-h-0 flex-1 resize-none border-0 bg-transparent p-3 text-[14px] leading-relaxed text-[var(--board-text)] outline-none placeholder:text-[var(--board-text-muted)]"
      />
      <div className="flex justify-end px-2 pb-2">
        <NotePushMenu worktreeId={worktreeId} text={card.text} />
      </div>
    </div>
  )
}
