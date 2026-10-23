import React, { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { KnowledgeTree } from '../../../../../shared/knowledge'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { buildMemoryPushPrompt, splitKnowledgeNotes, type MemoryNote } from './memory-studio-notes'
import { PushToConsoleMenu } from './PushToConsoleMenu'
import { StudioEmptyState } from './StudioEmptyState'

type NoteScope = 'repo' | 'global'
type NoteRead =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; content: string }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function useProjectRoots(worktreeId: string | null): string[] {
  const worktreePath = useAppStore((s) =>
    worktreeId ? (findWorktreeById(s.worktreesByRepo, worktreeId)?.path ?? null) : null
  )
  const repoPath = useAppStore((s) => {
    const repoId = worktreeId ? findWorktreeById(s.worktreesByRepo, worktreeId)?.repoId : null
    return repoId ? (s.repos.find((repo) => repo.id === repoId)?.path ?? null) : null
  })
  return useMemo(
    () => [repoPath, worktreePath].filter((p): p is string => Boolean(p)),
    [repoPath, worktreePath]
  )
}

// Project knowledge (memory, lessons, per-repo context, house rules) indexed by
// main from this machine's ~/.claude and the added repos. Read-only here; each
// note can be pushed into a console as context.
export function ProjectKnowledgePanel({
  worktreeId
}: {
  worktreeId: string | null
}): React.JSX.Element {
  const [tree, setTree] = useState<KnowledgeTree | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const [scope, setScope] = useState<NoteScope>('repo')
  const [selected, setSelected] = useState<MemoryNote | null>(null)
  const projectRoots = useProjectRoots(worktreeId)

  useEffect(() => window.api.knowledge.onChanged(() => setGeneration((g) => g + 1)), [])

  useEffect(() => {
    let cancelled = false
    window.api.knowledge.tree().then(
      (next) => {
        if (!cancelled) {
          setTree(next)
          setLoadError(null)
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setLoadError(errorText(error))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [generation])

  const split = useMemo(
    () => (tree ? splitKnowledgeNotes(tree, projectRoots) : null),
    [projectRoots, tree]
  )

  if (loadError) {
    return (
      <StudioEmptyState
        title={translate(
          'board.studio.memory.knowledgeFailed',
          'Could not load project knowledge.'
        )}
        detail={loadError}
      />
    )
  }
  if (!split) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-[var(--board-text-muted)]" />
      </div>
    )
  }
  const notes = split[scope]
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--board-panel-border)]">
        <div
          role="tablist"
          aria-label={translate('board.studio.memory.scope', 'Knowledge scope')}
          className="flex shrink-0 gap-1 p-2"
        >
          {(['repo', 'global'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scope === value}
              onClick={() => setScope(value)}
              className={cn(
                'flex-1 rounded-[8px] px-2 py-1 text-[12px] text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)]',
                scope === value && 'bg-[var(--board-accent-tint)] text-[var(--board-text)]'
              )}
            >
              {value === 'repo'
                ? translate('board.studio.memory.scopeRepo', 'This project')
                : translate('board.studio.memory.scopeGlobal', 'Global')}
              <span className="ml-1 tabular-nums">{split[value].length}</span>
            </button>
          ))}
        </div>
        {notes.length === 0 ? (
          <StudioEmptyState
            title={
              scope === 'repo'
                ? translate('board.studio.memory.noRepoNotes', 'No notes for this project yet.')
                : translate('board.studio.memory.noGlobalNotes', 'No global notes yet.')
            }
          />
        ) : (
          <ul className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {notes.map((note) => (
              <li key={note.filePath}>
                <button
                  type="button"
                  aria-current={selected?.filePath === note.filePath || undefined}
                  title={note.filePath}
                  onClick={() => setSelected(note)}
                  className={cn(
                    'flex w-full flex-col items-start rounded-[10px] px-2.5 py-1.5 text-left hover:bg-[var(--board-panel-2)]',
                    selected?.filePath === note.filePath && 'bg-[var(--board-accent-tint)]'
                  )}
                >
                  <span className="w-full truncate text-[13px] text-[var(--board-text)]">
                    {note.title}
                  </span>
                  <span className="w-full truncate text-[11px] text-[var(--board-text-muted)]">
                    {note.branchLabel}
                    {note.summary ? ` · ${note.summary}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {selected ? (
          <KnowledgeNoteReader key={selected.filePath} note={selected} worktreeId={worktreeId} />
        ) : (
          <StudioEmptyState
            title={translate('board.studio.memory.pickNote', 'Pick a note to read it here.')}
          />
        )}
      </section>
    </div>
  )
}

function KnowledgeNoteReader({
  note,
  worktreeId
}: {
  note: MemoryNote
  worktreeId: string | null
}): React.JSX.Element {
  const [read, setRead] = useState<NoteRead>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    window.api.knowledge.read(note.filePath).then(
      (result) => {
        if (!cancelled) {
          setRead({ status: 'ready', content: result.content })
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setRead({ status: 'error', message: errorText(error) })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [note.filePath])

  if (read.status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-[var(--board-text-muted)]" />
      </div>
    )
  }
  if (read.status === 'error') {
    return (
      <StudioEmptyState
        title={translate('board.studio.memory.readFailed', 'Could not open this note.')}
        detail={read.message}
      />
    )
  }
  return (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-[var(--board-panel-border)] px-4">
        <span className="min-w-0 truncate font-mono text-[11px] text-[var(--board-text-muted)]">
          {note.filePath}
        </span>
        <PushToConsoleMenu
          worktreeId={worktreeId}
          prompt={buildMemoryPushPrompt({ ...note, content: read.content })}
        />
      </div>
      <article className="scrollbar-sleek prose prose-sm min-h-0 max-w-none flex-1 overflow-y-auto px-8 py-6 text-[var(--board-text)] dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{read.content}</ReactMarkdown>
      </article>
    </>
  )
}
