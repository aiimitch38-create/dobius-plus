import React, { useCallback, useMemo, useState } from 'react'
import {
  Check,
  Code2,
  CopyPlus,
  File,
  FolderPlus,
  Loader2,
  PanelLeft,
  Plus,
  Save,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { useRepoById, useWorktreeById } from '@/store/selectors'
import { basename } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { requestEditorFileSave } from '@/components/editor/editor-autosave'
import type { FileContent } from '@/components/editor/editor-panel-content-types'
import { EditorSurfaceContext } from '@/components/editor/editor-surface-context'
import { addFileCardToBoard } from './board-file-card'
import { EditorPanel } from './board-studio-lazy-pages'
import { CodeFileBrowser, type CodeCreation } from './CodeFileBrowser'
import { codeFileMetadata, codeLanguageLabel } from './code-file-metadata'
import { StudioEmptyState } from './StudioEmptyState'
import './code-studio.css'

function StudioIconButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={onClick}
          className="size-8 shrink-0 rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)]"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function CodeWorkspace({
  worktreeId,
  worktreePath,
  projectName,
  onClose
}: {
  worktreeId: string
  worktreePath: string
  projectName: string
  onClose: () => void
}): React.JSX.Element {
  const activeFile = useAppStore((s) => {
    const id = s.activeFileIdByWorktree[worktreeId]
    return s.openFiles.find((file) => file.id === id && file.worktreeId === worktreeId) ?? null
  })
  const draft = useAppStore((s) => (activeFile ? s.editorDrafts[activeFile.id] : undefined))
  const [loaded, setLoaded] = useState<{ fileId: string; data: FileContent } | null>(null)
  const [creating, setCreating] = useState<CodeCreation>(null)
  const [saving, setSaving] = useState(false)
  const [filesVisible, setFilesVisible] = useState(false)
  const onContentReady = useCallback((fileId: string, content: FileContent | undefined): void => {
    if (content) {
      setLoaded({ fileId, data: content })
    }
  }, [])
  const surface = useMemo(() => ({ kind: 'board-code' as const, onContentReady }), [onContentReady])
  const data = loaded?.fileId === activeFile?.id ? loaded?.data : undefined
  const metadata =
    data && !data.isBinary && !data.loadError ? codeFileMetadata(draft ?? data.content) : null
  const editable = activeFile?.mode === 'edit' && !data?.isBinary && !data?.loadError
  const insertable = editable && !activeFile?.isUntitled && !!data
  const save = async (): Promise<boolean> => {
    if (!activeFile || saving) {
      return false
    }
    setSaving(true)
    try {
      await requestEditorFileSave({
        fileId: activeFile.id,
        fallbackContent: draft ?? data?.content
      })
      return true
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : translate('board.studio.code.saveFailed', 'Could not save this file.')
      )
      return false
    } finally {
      setSaving(false)
    }
  }
  const startCreating = (kind: CodeCreation): void => {
    setCreating(kind)
    setFilesVisible(true)
  }
  const saveLabel = saving
    ? translate('board.studio.code.saving', 'Saving…')
    : activeFile?.isDirty
      ? translate('board.studio.code.save', 'Save')
      : data && !data.loadError
        ? translate('board.studio.code.saved', 'Saved')
        : translate('board.studio.code.save', 'Save')

  return (
    <div className="board-code-studio" data-files-visible={filesVisible}>
      <aside className="board-code-sidebar">
        <header className="board-code-project-header">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--board-accent-tint)] text-[var(--board-accent)]"
          >
            <Code2 className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[22px] leading-tight font-bold tracking-[-0.02em]">
              {translate('board.studio.title.code', 'Code')}
            </h2>
            <p
              className="mt-1 truncate text-[13px] text-[var(--board-text-muted)]"
              title={worktreePath}
            >
              {projectName}
            </p>
          </div>
          <StudioIconButton
            label={translate('board.studio.code.newFile', 'New file')}
            onClick={() => startCreating('file')}
          >
            <Plus className="size-4" />
          </StudioIconButton>
        </header>
        <CodeFileBrowser
          worktreeId={worktreeId}
          worktreePath={worktreePath}
          selectedPath={activeFile?.filePath}
          creating={creating}
          onCreated={() => setCreating(null)}
          onFileOpened={() => setFilesVisible(false)}
        />
      </aside>
      <section
        aria-label={translate('board.studio.code.editor', 'File editor')}
        className="board-code-main"
      >
        <header className="board-code-toolbar">
          <div className="board-code-files-toggle">
            <StudioIconButton
              label={translate('board.studio.code.toggleFiles', 'Toggle project files')}
              onClick={() => setFilesVisible((visible) => !visible)}
            >
              <PanelLeft className="size-4" />
            </StudioIconButton>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <File className="size-4 shrink-0 text-[var(--board-text-muted)]" />
            <span className="truncate text-[14px] font-semibold" title={activeFile?.relativePath}>
              {activeFile
                ? basename(activeFile.filePath)
                : translate('board.studio.code.chooseFile', 'Choose a file')}
            </span>
            {activeFile ? (
              <span className="board-code-language">{codeLanguageLabel(activeFile.language)}</span>
            ) : null}
            {metadata ? (
              <span className="board-code-metadata">
                {translate('board.studio.code.lineCount', '{{count}} lines', {
                  count: metadata.lines
                })}{' '}
                · {metadata.size}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              aria-label={translate('board.studio.code.addFolder', 'Add folder')}
              className="board-code-action board-code-folder-action"
              onClick={() => startCreating('directory')}
            >
              <FolderPlus className="size-3.5" />
              <span>{translate('board.studio.code.addFolder', 'Add folder')}</span>
            </Button>
            {activeFile ? (
              <Button
                type="button"
                variant="outline"
                aria-label={saveLabel}
                className="board-code-action board-code-save-action"
                disabled={saving || !editable || !data || !activeFile.isDirty}
                onClick={() => void save()}
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : activeFile.isDirty ? (
                  <Save className="size-3.5" />
                ) : (
                  <Check className="size-3.5" />
                )}
                <span>{saveLabel}</span>
              </Button>
            ) : null}
            <Button
              type="button"
              className="board-code-insert"
              disabled={!insertable || saving}
              onClick={async () => {
                if (activeFile && insertable) {
                  if (activeFile.isDirty && !(await save())) {
                    return
                  }
                  addFileCardToBoard(worktreeId, activeFile.filePath)
                  onClose()
                }
              }}
            >
              <CopyPlus className="size-3.5" />
              <span>{translate('board.studio.code.insert', 'Insert')}</span>
            </Button>
            <StudioIconButton label={translate('board.studio.close', 'Close')} onClick={onClose}>
              <X className="size-4" />
            </StudioIconButton>
          </div>
        </header>
        <div className="board-code-editor-inset">
          <div className={cn('board-code-editor', !activeFile && 'is-empty')}>
            {activeFile ? (
              <EditorSurfaceContext.Provider value={surface}>
                <EditorPanel activeFileId={activeFile.id} />
              </EditorSurfaceContext.Provider>
            ) : (
              <StudioEmptyState
                title={translate('board.studio.code.pickFile', 'Pick a file to open it here.')}
                detail={translate(
                  'board.studio.code.pickFileDetail',
                  'Browse your project on the left, or create a new file.'
                )}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export function CodeStudio({
  worktreeId,
  onClose
}: {
  worktreeId: string | null
  onClose: () => void
}): React.JSX.Element {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const worktree = useWorktreeById(worktreeId)
  const repo = useRepoById(worktree?.repoId ?? null)
  if (!worktreeId || !worktree || activeWorktreeId !== worktreeId) {
    return (
      <div className="relative flex h-full flex-col">
        <div className="absolute top-4 right-4">
          <StudioIconButton label={translate('board.studio.close', 'Close')} onClick={onClose}>
            <X className="size-4" />
          </StudioIconButton>
        </div>
        <StudioEmptyState
          title={
            !worktreeId || !worktree
              ? translate('board.studio.code.noWorkspace', 'Open a workspace to browse its code.')
              : translate(
                  'board.studio.code.inactiveWorkspace',
                  'The code browser follows the active workspace. Switch to this board’s workspace to browse its files.'
                )
          }
        />
      </div>
    )
  }
  return (
    <CodeWorkspace
      key={worktreeId}
      worktreeId={worktreeId}
      worktreePath={worktree.path}
      projectName={repo?.displayName ?? basename(worktree.path)}
      onClose={onClose}
    />
  )
}
