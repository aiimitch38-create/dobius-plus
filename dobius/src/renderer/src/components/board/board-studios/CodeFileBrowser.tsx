import React, { useState } from 'react'
import { ChevronRight, File, Folder, FolderOpen, Loader2, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import { cn } from '@/lib/utils'
import type { DirCache, TreeNode } from '@/components/right-sidebar/file-explorer-types'
import { useCodeFileTree } from './use-code-file-tree'

export type CodeCreation = 'file' | 'directory' | null

function DirectoryRows({
  nodes,
  cache,
  expanded,
  selectedPath,
  onOpen
}: {
  nodes: TreeNode[]
  cache: Record<string, DirCache>
  expanded: Set<string>
  selectedPath?: string
  onOpen: (node: TreeNode) => void
}): React.JSX.Element {
  const sorted = [...nodes].sort(
    (a, b) =>
      Number(b.isDirectory) - Number(a.isDirectory) ||
      a.name.localeCompare(b.name, undefined, { numeric: true })
  )
  return (
    <ul>
      {sorted.map((node) => {
        const isOpen = expanded.has(node.path)
        const FileIcon = node.isDirectory
          ? isOpen
            ? FolderOpen
            : Folder
          : getFileTypeIcon(node.name)
        return (
          <li key={node.path}>
            <button
              type="button"
              aria-expanded={node.isDirectory ? isOpen : undefined}
              aria-current={!node.isDirectory && selectedPath === node.path ? 'page' : undefined}
              title={node.relativePath}
              className={cn('board-code-file-row', selectedPath === node.path && 'is-selected')}
              style={{ paddingLeft: 10 + node.depth * 16 }}
              onClick={() => onOpen(node)}
            >
              {node.isDirectory ? (
                <ChevronRight
                  className={cn(
                    'size-3.5 shrink-0 text-[var(--board-text-muted)] transition-transform motion-reduce:transition-none',
                    isOpen && 'rotate-90'
                  )}
                />
              ) : (
                <span className="w-3.5 shrink-0" />
              )}
              <FileIcon
                className={cn(
                  'size-4 shrink-0',
                  node.isDirectory ? 'text-[var(--board-accent)]' : 'text-[var(--board-text-muted)]'
                )}
              />
              <span className="min-w-0 truncate">{node.name}</span>
            </button>
            {node.isDirectory && isOpen ? (
              cache[node.path]?.loading && !cache[node.path]?.children.length ? (
                <div role="status" className="px-8 py-2 text-[var(--board-text-muted)]">
                  <Loader2 className="size-3.5 animate-spin" />
                </div>
              ) : (
                <DirectoryRows
                  nodes={cache[node.path]?.children ?? []}
                  cache={cache}
                  expanded={expanded}
                  selectedPath={selectedPath}
                  onOpen={onOpen}
                />
              )
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function CodeFileBrowser({
  worktreeId,
  worktreePath,
  selectedPath,
  creating,
  onCreated,
  onFileOpened
}: {
  worktreeId: string
  worktreePath: string
  selectedPath?: string
  creating: CodeCreation
  onCreated: () => void
  onFileOpened: () => void
}): React.JSX.Element {
  const tree = useCodeFileTree(worktreeId, worktreePath)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const create = async (): Promise<void> => {
    if (!creating || busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await tree.create(name, creating)
      if (creating === 'file') {
        onFileOpened()
      }
      setName('')
      onCreated()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <nav
      aria-label={translate('board.studio.code.files', 'Project files')}
      className="scrollbar-sleek min-h-0 flex-1 overflow-auto px-2.5 py-2"
    >
      {creating ? (
        <form
          className="mb-2 rounded-lg border border-[var(--board-panel-border)] p-2"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <label className="mb-2 flex items-center gap-2 text-[12px] font-medium">
            {creating === 'file' ? <File className="size-4" /> : <Folder className="size-4" />}
            {creating === 'file'
              ? translate('board.studio.code.newFile', 'New file')
              : translate('board.studio.code.newFolder', 'New folder')}
          </label>
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              aria-label={translate('board.studio.code.name', 'Name')}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  onCreated()
                }
              }}
              className="h-8 min-w-0 bg-[var(--board-panel)] text-[13px]"
            />
            <Button
              type="submit"
              size="sm"
              disabled={busy || !name.trim()}
              className="h-8 rounded-full bg-[var(--board-accent)] text-[var(--board-accent-fg)]"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                translate('board.studio.code.create', 'Create')
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={translate('common.cancel', 'Cancel')}
              onClick={onCreated}
              className="size-7"
            >
              <X className="size-3.5" />
            </Button>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-[12px] text-[var(--board-danger-text)]">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
      {tree.error ? (
        <div role="alert" className="space-y-2 p-3 text-[12px] text-[var(--board-danger-text)]">
          <p>{tree.error}</p>
          <Button variant="outline" size="sm" onClick={() => tree.resetAndLoad()}>
            {translate('common.retry', 'Retry')}
          </Button>
        </div>
      ) : null}
      {!tree.rootCache || (tree.rootCache.loading && !tree.rootCache.children.length) ? (
        <div role="status" className="flex justify-center p-6">
          <Loader2 className="size-4 animate-spin text-[var(--board-text-muted)]" />
        </div>
      ) : tree.rootCache.children.length ? (
        <DirectoryRows
          nodes={tree.rootCache.children}
          cache={tree.dirCache}
          expanded={tree.expanded}
          selectedPath={selectedPath}
          onOpen={(node) => {
            tree.open(node)
            if (!node.isDirectory) {
              onFileOpened()
            }
          }}
        />
      ) : (
        !tree.error && (
          <p className="p-3 text-[13px] text-[var(--board-text-muted)]">
            {translate('board.studio.code.empty', 'No files yet. Create a file to get started.')}
          </p>
        )
      )}
    </nav>
  )
}
