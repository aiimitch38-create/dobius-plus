import React, { useEffect, useRef, useState } from 'react'
import { Folder, Globe, MessageSquareText } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { formatPrCommentRelativeTime } from '@/lib/pr-comment-time'
import { BoardOutputViewer } from './BoardOutputViewer'

export type BoardThreadReport = {
  agent: string
  consoleTitle: string
  excerpt: string
  full: string
  at: number
}

export type BoardThreadMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  /** Optional follow-up button, e.g. "Turn on Voice Conductor in Settings". */
  action?: { label: string; onClick: () => void }
  tone?: 'error'
  /** A finished-agent reply rendered as a compact report row with a "See output" viewer. */
  report?: BoardThreadReport
  /** Never persisted — a mid-turn "thinking" placeholder or other UI-only row. */
  transient?: boolean
}

type BoardThreadProps = {
  messages: readonly BoardThreadMessage[]
  projectName: string
  languageLabel: string
}

function BoardThreadReportRow({ report }: { report: BoardThreadReport }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="w-full rounded-xl border border-[var(--board-panel-border)] bg-[var(--board-panel)] px-3 py-2.5">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="truncate font-semibold text-[var(--board-text)]">
          {report.agent} · {report.consoleTitle}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-[var(--board-text-muted)]">
          {formatPrCommentRelativeTime(new Date(report.at).toISOString(), Date.now())}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-[var(--board-text-muted)]">
        {report.excerpt}
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 rounded-full border border-[var(--board-chip-border)] bg-[var(--board-chip)] px-3 py-1 text-[12px] font-medium text-[var(--board-text)] hover:brightness-95"
      >
        {translate('board.thread.seeOutput', 'See output')}
      </button>
      <BoardOutputViewer report={report} open={open} onOpenChange={setOpen} />
    </div>
  )
}

export function BoardThread({
  messages,
  projectName,
  languageLabel
}: BoardThreadProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const lastMessageId = messages.at(-1)?.id

  useEffect(() => {
    const list = listRef.current
    if (list && lastMessageId) {
      list.scrollTop = list.scrollHeight
    }
  }, [lastMessageId])

  return (
    <section aria-label={translate('board.thread.title', 'Thread')} className="flex flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--board-panel-border)] h-[37px] px-4">
        <h2 className="text-[11px] font-semibold tracking-[0.12em] text-[var(--board-text-muted)] uppercase">
          {translate('board.thread.title', 'Thread')}
        </h2>
        <div className="ml-auto flex min-w-0 items-center gap-4 text-[13px] font-medium">
          <span className="flex min-w-0 items-center gap-1.5">
            <Folder className="size-3.5 shrink-0 text-[var(--board-text-muted)]" />
            <span className="truncate">{projectName}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <Globe className="size-3.5 text-[var(--board-text-muted)]" />
            {languageLabel}
          </span>
        </div>
      </header>
      <div
        ref={listRef}
        data-board-wheel="native"
        // Measured: the expanded panel is ~558x572 at 859px tall; the list takes what
        // the header, two chip rows and composer leave (482px), shrinking on short windows.
        className="scrollbar-sleek h-[min(377px,calc(100vh-482px))] overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageSquareText className="size-6 text-[var(--board-text-muted)]" />
            <p className="text-[15px] font-semibold">
              {translate('board.thread.emptyTitle', 'Nothing said yet')}
            </p>
            <p className="max-w-md text-[13px] text-[var(--board-text-muted)]">
              {translate(
                'board.thread.emptyHint',
                'Tell your agents what to do, move the board, or open a tool. Try “spawn two reviewers”, “fit the board”, “open loops”, or “what can you do?”'
              )}
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((message) =>
              message.report ? (
                <li key={message.id} className="w-full max-w-[85%] self-start">
                  <BoardThreadReportRow report={message.report} />
                </li>
              ) : (
                <li
                  key={message.id}
                  className={cn(
                    'max-w-[85%] text-[13px] leading-relaxed whitespace-pre-wrap',
                    message.role === 'user' &&
                      'self-end rounded-2xl bg-[var(--board-accent-tint)] px-3 py-2',
                    message.role === 'assistant' && 'self-start',
                    message.role === 'system' &&
                      'self-center text-[12px] text-[var(--board-text-muted)]',
                    message.tone === 'error' && 'text-[var(--board-danger-text)]'
                  )}
                >
                  {message.text}
                  {message.action ? (
                    <button
                      type="button"
                      onClick={message.action.onClick}
                      className="mt-1.5 block rounded-full border border-[var(--board-chip-border)] bg-[var(--board-chip)] px-3 py-1 text-[12px] font-medium text-[var(--board-text)] hover:brightness-95"
                    >
                      {message.action.label}
                    </button>
                  ) : null}
                </li>
              )
            )}
          </ol>
        )}
      </div>
    </section>
  )
}
