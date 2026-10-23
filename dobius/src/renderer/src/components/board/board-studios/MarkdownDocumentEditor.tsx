import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { RichMarkdownErrorBoundary } from '@/components/editor/RichMarkdownErrorBoundary'
import { extractFrontMatter, prependFrontMatter } from '@/components/editor/markdown-frontmatter'
import { translate } from '@/i18n/i18n'
import { getConnectionId } from '@/lib/connection-context'
import { cn } from '@/lib/utils'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { readRuntimeFileContent, writeRuntimeFile } from '@/runtime/runtime-file-client'
import { useAppStore } from '@/store'
import { BOARD_MONO_CLASS, BOARD_PILL_BUTTON_CLASS } from '../board-chrome/board-surface-classes'
import { StudioEmptyState } from './StudioEmptyState'
import type { RepoDocument } from './use-repo-documents'

const RichMarkdownEditor = lazy(() => import('@/components/editor/RichMarkdownEditor'))

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; content: string }

function runtimeContext(worktreeId: string, worktreePath: string | null) {
  return {
    settings: getSettingsForWorktreeRuntimeOwner(useAppStore.getState(), worktreeId),
    worktreeId,
    worktreePath,
    connectionId: getConnectionId(worktreeId) ?? undefined
  }
}

// Why: the studio edits through the runtime file client (local or SSH) instead
// of the editor slice, so it never opens or replaces tabs in Classic.
export function MarkdownDocumentEditor({
  worktreeId,
  worktreePath,
  runtimeEnvironmentId,
  doc,
  documents,
  onOpenDocument
}: {
  worktreeId: string
  worktreePath: string | null
  runtimeEnvironmentId: string | null
  doc: RepoDocument
  documents: RepoDocument[]
  onOpenDocument: (target: string) => void
}): React.JSX.Element {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const draftRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoad({ status: 'loading' })
    readRuntimeFileContent({
      settings: getSettingsForWorktreeRuntimeOwner(useAppStore.getState(), worktreeId),
      filePath: doc.filePath,
      relativePath: doc.relativePath,
      worktreeId,
      connectionId: getConnectionId(worktreeId) ?? undefined
    }).then(
      (result) => {
        if (!cancelled) {
          setLoad({ status: 'ready', content: result.content })
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoad({
            status: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [doc.filePath, doc.relativePath, worktreeId])

  const save = useCallback(
    async (content: string): Promise<void> => {
      setSaving(true)
      try {
        await writeRuntimeFile(runtimeContext(worktreeId, worktreePath), doc.filePath, content)
        if (draftRef.current === content) {
          draftRef.current = null
          setDirty(false)
        }
      } catch (error) {
        toast.error(
          translate('board.studio.markdown.saveFailed', 'Could not save {{name}}: {{error}}', {
            name: doc.basename,
            error: error instanceof Error ? error.message : String(error)
          })
        )
      } finally {
        setSaving(false)
      }
    },
    [doc.basename, doc.filePath, worktreeId, worktreePath]
  )

  // Why: switching documents or closing the studio must not drop unsaved edits.
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(
    () => () => {
      if (draftRef.current !== null) {
        void saveRef.current(draftRef.current)
      }
    },
    [doc.filePath]
  )

  if (load.status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-[var(--board-text-muted)]" />
      </div>
    )
  }
  if (load.status === 'error') {
    return (
      <StudioEmptyState
        title={translate('board.studio.docs.readFailed', 'Could not open this document.')}
        detail={load.message}
      />
    )
  }

  const fm = extractFrontMatter(load.content)
  const withFrontMatter = (body: string): string => (fm ? prependFrontMatter(fm.raw, body) : body)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[var(--board-panel-border)] pr-2 pl-4">
        <span
          className={cn(
            'min-w-0 truncate text-[12px] text-[var(--board-text-muted)]',
            BOARD_MONO_CLASS
          )}
          title={doc.relativePath}
        >
          {doc.relativePath}
          {dirty ? ` · ${translate('board.studio.markdown.unsaved', 'unsaved')}` : ''}
        </span>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => draftRef.current !== null && void save(draftRef.current)}
          className={cn(
            BOARD_PILL_BUTTON_CLASS,
            'flex shrink-0 items-center gap-1.5 disabled:opacity-40'
          )}
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {translate('board.studio.markdown.save', 'Save')}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <RichMarkdownErrorBoundary fileId={doc.filePath}>
          <Suspense fallback={<Loader2 className="m-auto size-4 animate-spin" />}>
            <RichMarkdownEditor
              key={doc.filePath}
              fileId={`board-studio:${doc.filePath}`}
              content={fm ? fm.body : load.content}
              filePath={doc.filePath}
              worktreeId={worktreeId}
              runtimeEnvironmentId={runtimeEnvironmentId}
              scrollCacheKey={`board-studio-markdown:${doc.filePath}`}
              onContentChange={(body) => {
                draftRef.current = withFrontMatter(body)
              }}
              onDirtyStateHint={setDirty}
              onSave={(body) => void save(withFrontMatter(body))}
              onOpenDocLink={onOpenDocument}
              markdownDocuments={documents}
              markdownAnnotationsEnabled={false}
            />
          </Suspense>
        </RichMarkdownErrorBoundary>
      </div>
    </div>
  )
}
