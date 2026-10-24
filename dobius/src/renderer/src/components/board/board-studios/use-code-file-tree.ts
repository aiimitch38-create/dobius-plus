import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { getConnectionId } from '@/lib/connection-context'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { createRuntimePath, subscribeRuntimeFileChanges } from '@/runtime/runtime-file-client'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import { normalizeRuntimePathForComparison } from '../../../../../shared/cross-platform-path'
import { useFileExplorerTree } from '@/components/right-sidebar/useFileExplorerTree'
import type { TreeNode } from '@/components/right-sidebar/file-explorer-types'

export function useCodeFileTree(worktreeId: string, worktreePath: string) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const tree = useFileExplorerTree(worktreePath, expanded, worktreeId)
  const { resetAndLoad, loadDir } = tree
  const runtimeEnvironmentId = useAppStore(
    (s) => getSettingsForWorktreeRuntimeOwner(s, worktreeId).activeRuntimeEnvironmentId ?? null
  )
  const sshGeneration = useAppStore((s) => s.sshConnectedGeneration)
  const connectionId = getConnectionId(worktreeId) ?? undefined
  const context = useMemo(
    () => ({
      worktreeId,
      worktreePath,
      connectionId,
      settings: { activeRuntimeEnvironmentId: runtimeEnvironmentId }
    }),
    [worktreeId, worktreePath, runtimeEnvironmentId, connectionId]
  )
  const refreshRef = useRef(tree.refreshTree)
  refreshRef.current = tree.refreshTree

  useEffect(() => resetAndLoad(), [resetAndLoad, runtimeEnvironmentId, sshGeneration])
  useEffect(() => {
    setError(null)
    let disposed = false
    let unsubscribe: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => void refreshRef.current(), 150)
    }
    void subscribeRuntimeFileChanges(context, (payload) => {
      if (
        normalizeRuntimePathForComparison(payload.worktreePath) ===
        normalizeRuntimePathForComparison(worktreePath)
      ) {
        refresh()
      }
    })
      .then((stop) => {
        if (disposed) {
          stop()
        } else {
          unsubscribe = stop
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    window.addEventListener('focus', refresh)
    return () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe?.()
      window.removeEventListener('focus', refresh)
    }
  }, [context, worktreePath, sshGeneration])

  const open = useCallback(
    (node: TreeNode): void => {
      if (node.isDirectory) {
        setExpanded((previous) => {
          const next = new Set(previous)
          if (next.has(node.path)) {
            next.delete(node.path)
          } else {
            next.add(node.path)
          }
          return next
        })
        void loadDir(node.path, node.depth)
        return
      }
      useAppStore.getState().openFile(
        {
          filePath: node.path,
          relativePath: node.relativePath,
          worktreeId,
          runtimeEnvironmentId: runtimeEnvironmentId ?? undefined,
          language: detectLanguage(node.name),
          mode: 'edit'
        },
        { suppressActiveRuntimeFallback: runtimeEnvironmentId === null }
      )
    },
    [loadDir, worktreeId, runtimeEnvironmentId]
  )

  const create = async (name: string, kind: 'file' | 'directory'): Promise<void> => {
    const trimmed = name.trim()
    if (
      !trimmed ||
      trimmed === '.' ||
      trimmed === '..' ||
      /[\\/]/.test(trimmed) ||
      trimmed.includes('\0')
    ) {
      throw new Error(
        translate('board.studio.code.invalidName', 'Enter a name without path separators.')
      )
    }
    const path = joinPath(worktreePath, trimmed)
    await createRuntimePath(context, path, kind)
    await tree.refreshDir(worktreePath)
    if (kind === 'file') {
      open({ name: trimmed, path, relativePath: trimmed, depth: 0, isDirectory: false })
    }
  }
  return { ...tree, expanded, open, create, error: tree.rootError ?? error }
}
