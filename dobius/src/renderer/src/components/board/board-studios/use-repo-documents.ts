import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getConnectionId } from '@/lib/connection-context'
import { joinPath } from '@/lib/path'
import {
  getRuntimeEnvironmentIdForWorktree,
  getSettingsForWorktreeRuntimeOwner
} from '@/lib/worktree-runtime-owner'
import { listRuntimeFiles, listRuntimeMarkdownDocuments } from '@/runtime/runtime-file-client'
import type { MarkdownDocument } from '../../../../../shared/types'

export type RepoDocumentScope = 'markdown' | 'documents'
// Same shape as the editor's markdown documents so the list feeds [[link]] completion.
export type RepoDocument = MarkdownDocument

// Why: the Docs studio is for reading material, not source; keep the filter to
// formats the editor already renders (markdown + PDF viewer + plain text).
const DOCUMENT_EXTENSIONS = ['.pdf', '.md', '.markdown', '.txt']

export type RepoDocumentsResult = {
  documents: RepoDocument[] | null
  error: string | null
  worktreePath: string | null
  runtimeEnvironmentId: string | null
  reload: () => void
}

/** Lists the worktree's documents through the runtime that owns it (local or SSH). */
export function useRepoDocuments(
  worktreeId: string | null,
  scope: RepoDocumentScope
): RepoDocumentsResult {
  const worktreePath = useAppStore((s) =>
    worktreeId ? (findWorktreeById(s.worktreesByRepo, worktreeId)?.path ?? null) : null
  )
  const runtimeEnvironmentId = useAppStore((s) => getRuntimeEnvironmentIdForWorktree(s, worktreeId))
  const [documents, setDocuments] = useState<RepoDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  useEffect(() => {
    if (!worktreeId || !worktreePath) {
      setDocuments([])
      return
    }
    let cancelled = false
    setDocuments(null)
    setError(null)
    const context = {
      settings: getSettingsForWorktreeRuntimeOwner(useAppStore.getState(), worktreeId),
      worktreeId,
      worktreePath,
      connectionId: getConnectionId(worktreeId) ?? undefined
    }
    const load: Promise<RepoDocument[]> =
      scope === 'markdown'
        ? listRuntimeMarkdownDocuments(context, worktreePath).then((docs) =>
            [...docs].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
          )
        : listRuntimeFiles(context, { rootPath: worktreePath }).then((relativePaths) =>
            relativePaths
              .filter((p) => DOCUMENT_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext)))
              .sort((a, b) => a.localeCompare(b))
              .map((relativePath) => {
                const basename = relativePath.split(/[\\/]/).pop() ?? relativePath
                return {
                  filePath: joinPath(worktreePath, relativePath),
                  relativePath,
                  basename,
                  name: basename
                }
              })
          )
    load.then(
      (docs) => {
        if (!cancelled) {
          setDocuments(docs)
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setDocuments([])
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [generation, scope, worktreeId, worktreePath])

  return { documents, error, worktreePath, runtimeEnvironmentId, reload }
}
