import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import MarkdownPreview from '@/components/editor/MarkdownPreview'
import { getConnectionId } from '@/lib/connection-context'
import type { BoardCardOf } from '@/store/slices/board'
import { codeAsMarkdown, isMarkdownPath } from './code-as-markdown'
import { translate } from '@/i18n/i18n'

type Load =
  | { status: 'loading' }
  | { status: 'ready'; content: string }
  | { status: 'error'; message: string }

export function MarkdownDocCard({
  card,
  worktreeId
}: {
  card: BoardCardOf<'markdown'>
  worktreeId: string
}): React.JSX.Element {
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    // Why: SSH worktrees must read through their relay connection, not the local disk.
    window.api.fs
      .readFile({ filePath: card.path, connectionId: getConnectionId(worktreeId) ?? undefined })
      .then((result) => {
        if (!cancelled) {
          setLoad(
            result.isBinary
              ? {
                  status: 'error',
                  message: translate('board.markdown.notText', 'This file is not text.')
                }
              : { status: 'ready', content: result.content }
          )
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [card.path, worktreeId])

  if (load.status !== 'ready') {
    return (
      <div className="flex size-full items-center justify-center gap-2 p-4 text-center text-[13px] text-[var(--board-text-muted)]">
        {load.status === 'loading' ? <Loader2 className="size-4 animate-spin" /> : load.message}
      </div>
    )
  }
  // Why: source files arrive here too ("Add to board" from Code); render them
  // as highlighted, read-only code instead of interpreting them as markdown.
  const code = isMarkdownPath(card.path) ? null : codeAsMarkdown(card.path, load.content)
  return (
    <div className="flex size-full flex-col overflow-hidden">
      {code?.truncated && (
        <div className="shrink-0 border-b border-[var(--board-panel-border)] px-3 py-1 text-[12px] text-[var(--board-text-muted)]">
          {translate('board.markdown.truncated', 'Showing the first part of a large file.')}
        </div>
      )}
      <MarkdownPreview
        content={code ? code.markdown : load.content}
        filePath={card.path}
        sourceWorktreeId={worktreeId}
        scrollCacheKey={`board-markdown:${card.id}`}
      />
    </div>
  )
}
