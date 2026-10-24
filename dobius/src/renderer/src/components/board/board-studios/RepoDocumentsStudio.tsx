import React, { useState } from 'react'
import {
  Download,
  FileText,
  LayoutDashboard,
  Loader2,
  Network,
  RefreshCw,
  Sparkles
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  resolveMarkdownDocLink,
  createMarkdownDocumentIndex
} from '@/components/editor/markdown-doc-links'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BOARD_ICON_BUTTON_CLASS } from '../board-chrome/board-surface-classes'
import { addFileCardToBoard } from './board-file-card'
import {
  exportRepoDocument,
  isExportableDocument,
  type DocumentExportFormat
} from './document-generation-export-actions'
import { GenerateDocumentPanel } from './GenerateDocumentPanel'
import { MarkdownDocumentEditor } from './MarkdownDocumentEditor'
import { MarkdownLinkGraphView } from './MarkdownLinkGraphView'
import { RepoDocumentReader } from './RepoDocumentReader'
import { StudioEmptyState } from './StudioEmptyState'
import { useRepoDocuments, type RepoDocument, type RepoDocumentScope } from './use-repo-documents'

type MainPane = 'document' | 'generate' | 'graph'

function ExportDocumentMenu({
  onExport
}: {
  onExport: (format: DocumentExportFormat) => void
}): React.JSX.Element {
  const label = translate('board.studio.docs.export', 'Export')
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              className={cn(BOARD_ICON_BUTTON_CLASS, 'size-7')}
            >
              <Download className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={4}>
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          {translate(
            'board.studio.docs.exportPdfHint',
            'PDF with title page, contents and page numbers'
          )}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onExport({ kind: 'pdf', pageSize: 'Letter' })}>
          {translate('board.studio.docs.exportPdfLetter', 'PDF, US Letter')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onExport({ kind: 'pdf', pageSize: 'A4' })}>
          {translate('board.studio.docs.exportPdfA4', 'PDF, A4')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onExport({ kind: 'markdown' })}>
          {translate('board.studio.docs.exportMarkdown', 'Markdown (.md)')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HeaderIconButton({
  label,
  pressed,
  onClick,
  children
}: {
  label: string
  pressed?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={pressed}
          className={cn(
            BOARD_ICON_BUTTON_CLASS,
            'size-7',
            pressed && 'bg-[var(--board-accent-tint)] text-[var(--board-accent)]'
          )}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

// Markdown + Docs studios: a document list on the left; on the right the Docs
// studio reads (or asks an agent to write) and the Markdown studio edits or
// shows the link graph. Files go through the runtime client, never Classic tabs.
export function RepoDocumentsStudio({
  worktreeId,
  scope,
  initialPane = 'document',
  onClose
}: {
  worktreeId: string | null
  scope: RepoDocumentScope
  initialPane?: MainPane
  onClose: () => void
}): React.JSX.Element {
  const { documents, error, reload, worktreePath, runtimeEnvironmentId } = useRepoDocuments(
    worktreeId,
    scope
  )
  const [selected, setSelected] = useState<RepoDocument | null>(null)
  const [pane, setPane] = useState<MainPane>(initialPane)

  if (!worktreeId) {
    return (
      <StudioEmptyState
        title={translate('board.studio.docs.noWorkspace', 'Open a workspace to see its documents.')}
      />
    )
  }

  const openDocument = (doc: RepoDocument): void => {
    setSelected(doc)
    setPane('document')
  }
  const openDocLink = (target: string): void => {
    const resolution = resolveMarkdownDocLink(target, createMarkdownDocumentIndex(documents ?? []))
    if (resolution.status === 'resolved') {
      openDocument(resolution.document)
    } else {
      toast.error(
        resolution.status === 'ambiguous'
          ? translate(
              'board.studio.markdown.linkAmbiguous',
              'More than one doc matches {{target}}.',
              { target }
            )
          : translate(
              'board.studio.markdown.linkMissing',
              'No doc named {{target}} in this workspace.',
              { target }
            )
      )
    }
  }
  const togglePane = (next: MainPane): void =>
    setPane((current) => (current === next ? 'document' : next))

  let main: React.ReactNode
  if (pane === 'generate') {
    main = <GenerateDocumentPanel worktreeId={worktreeId} onSent={() => setPane('document')} />
  } else if (pane === 'graph') {
    main = documents ? (
      <MarkdownLinkGraphView
        worktreeId={worktreeId}
        documents={documents}
        selectedPath={selected?.relativePath ?? null}
        onOpen={openDocument}
      />
    ) : null
  } else if (!selected) {
    main = (
      <StudioEmptyState
        title={translate('board.studio.docs.pickDocument', 'Pick a document to read it here.')}
      />
    )
  } else if (scope === 'markdown') {
    main = (
      <MarkdownDocumentEditor
        worktreeId={worktreeId}
        worktreePath={worktreePath}
        runtimeEnvironmentId={runtimeEnvironmentId}
        doc={selected}
        documents={documents ?? []}
        onOpenDocument={openDocLink}
      />
    )
  } else {
    main = <RepoDocumentReader worktreeId={worktreeId} doc={selected} />
  }

  const addToBoardLabel = translate('board.studio.addToBoard', 'Add to board')
  return (
    <div className="flex h-full min-h-0 min-w-0">
      <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--board-panel-border)]">
        <div className="flex h-10 shrink-0 items-center justify-between pr-1 pl-3">
          <span className="text-[11px] font-semibold tracking-[0.05em] text-[var(--board-text-muted)] uppercase">
            {scope === 'markdown'
              ? translate('board.studio.markdown.listTitle', 'Markdown')
              : translate('board.studio.docs.listTitle', 'Documents')}
            {documents ? ` · ${documents.length}` : ''}
          </span>
          <div className="flex items-center">
            {selected && isExportableDocument(selected) ? (
              <ExportDocumentMenu
                onExport={(format) =>
                  void exportRepoDocument({ worktreeId, doc: selected, format })
                }
              />
            ) : null}
            {scope === 'documents' ? (
              <HeaderIconButton
                label={translate('board.studio.docs.generate', 'Generate document')}
                pressed={pane === 'generate'}
                onClick={() => togglePane('generate')}
              >
                <Sparkles className="size-3.5" />
              </HeaderIconButton>
            ) : (
              <>
                <HeaderIconButton
                  label={translate('board.studio.markdown.graph', 'Link graph')}
                  pressed={pane === 'graph'}
                  onClick={() => togglePane('graph')}
                >
                  <Network className="size-3.5" />
                </HeaderIconButton>
                {selected ? (
                  <HeaderIconButton
                    label={addToBoardLabel}
                    onClick={() => {
                      addFileCardToBoard(worktreeId, selected.filePath)
                      onClose()
                    }}
                  >
                    <LayoutDashboard className="size-3.5" />
                  </HeaderIconButton>
                ) : null}
              </>
            )}
            <HeaderIconButton
              label={translate('board.studio.docs.refresh', 'Refresh list')}
              onClick={reload}
            >
              <RefreshCw className="size-3.5" />
            </HeaderIconButton>
          </div>
        </div>
        <DocumentList
          documents={documents}
          error={error}
          selectedFilePath={selected?.filePath ?? null}
          onOpen={openDocument}
        />
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">{main}</section>
    </div>
  )
}

function DocumentList({
  documents,
  error,
  selectedFilePath,
  onOpen
}: {
  documents: RepoDocument[] | null
  error: string | null
  selectedFilePath: string | null
  onOpen: (doc: RepoDocument) => void
}): React.JSX.Element {
  if (!documents) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-[var(--board-text-muted)]" />
      </div>
    )
  }
  if (error) {
    return (
      <StudioEmptyState
        title={translate('board.studio.docs.listFailed', 'Could not list documents.')}
        detail={error}
      />
    )
  }
  if (documents.length === 0) {
    return (
      <StudioEmptyState
        title={translate('board.studio.docs.none', 'No documents in this workspace.')}
      />
    )
  }
  return (
    <ul className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto p-2">
      {documents.map((doc) => {
        const selected = selectedFilePath === doc.filePath
        return (
          <li key={doc.filePath}>
            <button
              type="button"
              aria-current={selected || undefined}
              title={doc.relativePath}
              onClick={() => onOpen(doc)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left hover:bg-[var(--board-panel-2)]',
                selected && 'bg-[var(--board-accent-tint)]'
              )}
            >
              <FileText className="size-4 shrink-0 text-[var(--board-text-muted)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-[var(--board-text)]">
                  {doc.name}
                </span>
                <span className="block truncate font-mono text-[11px] text-[var(--board-text-muted)]">
                  {doc.relativePath}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
