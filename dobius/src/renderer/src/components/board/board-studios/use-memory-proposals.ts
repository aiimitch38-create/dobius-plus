import { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { getConnectionId } from '@/lib/connection-context'
import { joinPath } from '@/lib/path'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { deleteRuntimePath, readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { pushNoteToConsole } from '../cards/note-push'
import { MEMORY_PROPOSALS_FILE, parseProposals, type MemoryProposal } from './memory-entries'

const POLL_MS = 4000
// ponytail: give up after 15 min; the user can re-run the scan.
const POLL_LIMIT_MS = 15 * 60_000

export type ProposalsState =
  | { status: 'idle' }
  | { status: 'waiting'; consoleTitle: string }
  | { status: 'ready'; proposals: MemoryProposal[] }
  | { status: 'error'; message: string }

function fileContext(worktreeId: string) {
  const state = useAppStore.getState()
  const worktreePath = findWorktreeById(state.worktreesByRepo, worktreeId)?.path ?? null
  if (!worktreePath) {
    return null
  }
  return {
    settings: getSettingsForWorktreeRuntimeOwner(state, worktreeId),
    worktreeId,
    worktreePath,
    connectionId: getConnectionId(worktreeId) ?? undefined,
    filePath: joinPath(worktreePath, MEMORY_PROPOSALS_FILE)
  }
}

async function readProposals(worktreeId: string): Promise<MemoryProposal[] | null> {
  const ctx = fileContext(worktreeId)
  if (!ctx) {
    return null
  }
  try {
    const { content } = await readRuntimeFileContent({
      ...ctx,
      relativePath: MEMORY_PROPOSALS_FILE
    })
    return parseProposals(content)
  } catch {
    // Not written yet (or mid-write): keep polling.
    return null
  }
}

async function removeProposalsFile(worktreeId: string): Promise<void> {
  const ctx = fileContext(worktreeId)
  if (!ctx) {
    return
  }
  try {
    await deleteRuntimePath(ctx, ctx.filePath)
  } catch {
    // Missing file is the normal case.
  }
}

/**
 * Scan/refresh run in a real board console (same SSH-aware notes-send path as
 * document generation); the agent writes MEMORY_PROPOSALS_FILE and this hook
 * polls for it. The old file is removed first so a stale answer never shows.
 */
export function useMemoryProposals(worktreeId: string | null) {
  const [state, setState] = useState<ProposalsState>({ status: 'idle' })
  const startedAt = useRef(0)

  useEffect(() => {
    if (state.status !== 'waiting' || !worktreeId) {
      return
    }
    let cancelled = false
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt.current > POLL_LIMIT_MS) {
        setState({
          status: 'error',
          message: translate(
            'board.memory.scanTimeout',
            'No answer from the agent after 15 minutes.'
          )
        })
        return
      }
      void readProposals(worktreeId).then((proposals) => {
        if (!cancelled && proposals && proposals.length > 0) {
          setState({ status: 'ready', proposals })
          void removeProposalsFile(worktreeId)
        }
      })
    }, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [state.status, worktreeId])

  const request = useCallback(
    async (tabId: string, consoleTitle: string, prompt: string): Promise<string | null> => {
      if (!worktreeId) {
        return translate('board.memory.needWorkspace', 'Open a workspace first.')
      }
      await removeProposalsFile(worktreeId)
      const error = await pushNoteToConsole(worktreeId, tabId, prompt)
      if (!error) {
        startedAt.current = Date.now()
        setState({ status: 'waiting', consoleTitle })
      }
      return error
    },
    [worktreeId]
  )

  const reset = useCallback(() => setState({ status: 'idle' }), [])
  const setProposals = useCallback(
    (proposals: MemoryProposal[]) =>
      setState(proposals.length ? { status: 'ready', proposals } : { status: 'idle' }),
    []
  )
  return { state, request, reset, setProposals }
}
