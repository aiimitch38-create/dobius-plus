import React, { lazy, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { translate } from '@/i18n/i18n'
import { getConnectionId } from '@/lib/connection-context'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { useAppStore } from '@/store'
import { BOARD_MONO_CLASS } from '../board-chrome/board-surface-classes'
import { StudioEmptyState } from './StudioEmptyState'
import type { RepoDocument } from './use-repo-documents'

const PdfViewer = lazy(() => import('@/components/editor/PdfViewer'))

type ReadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; content: string; isBinary: boolean }

// Why: the studio reads documents itself instead of calling the editor's
// openFile, which would add tabs to (and replace preview tabs in) Classic.
export function RepoDocumentReader({
  worktreeId,
  doc
}: {
  worktreeId: string
  doc: RepoDocument
}): React.JSX.Element {
  const [state, setState] = useState<ReadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    readRuntimeFileContent({
      settings: getSettingsForWorktreeRuntimeOwner(useAppStore.getState(), worktreeId),
      filePath: doc.filePath,
      relativePath: doc.relativePath,
      worktreeId,
      connectionId: getConnectionId(worktreeId) ?? undefined
    })
      .then((result) => {
        if (!cancelled) {
          setState({ status: 'ready', content: result.content, isBinary: result.isBinary })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [doc.filePath, doc.relativePath, worktreeId])

  if (state.status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-[var(--board-text-muted)]" />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <StudioEmptyState
        title={translate('board.studio.docs.readFailed', 'Could not open this document.')}
        detail={state.message}
      />
    )
  }
  const lower = doc.relativePath.toLowerCase()
  if (lower.endsWith('.pdf')) {
    return (
      <React.Suspense fallback={<Loader2 className="m-auto size-4 animate-spin" />}>
        <PdfViewer content={state.content.replace(/\s/g, '')} filePath={doc.filePath} />
      </React.Suspense>
    )
  }
  if (state.isBinary) {
    return (
      <StudioEmptyState
        title={translate('board.studio.docs.binary', 'This file cannot be shown as text.')}
      />
    )
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return (
      <article className="scrollbar-sleek prose prose-sm min-h-0 max-w-none flex-1 overflow-y-auto px-8 py-6 text-[var(--board-text)] dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.content}</ReactMarkdown>
      </article>
    )
  }
  return (
    <pre
      className={`scrollbar-sleek min-h-0 flex-1 overflow-auto px-6 py-5 text-[12px] whitespace-pre-wrap ${BOARD_MONO_CLASS}`}
    >
      {state.content}
    </pre>
  )
}
