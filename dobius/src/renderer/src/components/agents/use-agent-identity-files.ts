import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { AgentReadableFiles } from '../../../../shared/agents'
import { isAgentFileConflictError } from '../../../../shared/agent-file-conflict'
import { DEFAULT_AGENT_FILES } from './agent-default-files'

export const AGENT_FILE_NAMES = ['soul', 'role', 'playbook', 'rules', 'brief', 'memory'] as const
export type AgentFileName = (typeof AGENT_FILE_NAMES)[number]

type WriteAgentFile = (
  agentId: string,
  name: AgentFileName,
  content: string,
  expected?: string
) => Promise<void>

// Writes only files the user changed since they were loaded, each guarded by the
// loaded copy so main refuses to overwrite newer on-disk content. A null baseline
// means a brand-new agent: every file is written. Returns the names that were
// written; rethrows the first failure after recording partial progress.
export async function writeEditedAgentFiles(args: {
  agentId: string
  files: AgentReadableFiles
  baseline: AgentReadableFiles | null
  names?: readonly AgentFileName[]
  write: WriteAgentFile
}): Promise<{ written: AgentFileName[]; error: unknown }> {
  const { agentId, files, baseline, write } = args
  const names = (args.names ?? AGENT_FILE_NAMES).filter(
    (name) => !baseline || files[name] !== baseline[name]
  )
  const results = await Promise.allSettled(
    names.map((name) => write(agentId, name, files[name], baseline?.[name]))
  )
  const written = names.filter((_, index) => results[index].status === 'fulfilled')
  const failed = results.find((result) => result.status === 'rejected')
  return { written, error: failed ? failed.reason : null }
}

export function useAgentIdentityFiles(selectedAgentId: string | null): {
  agentFiles: AgentReadableFiles
  setAgentFiles: (files: AgentReadableFiles) => void
  resetAgentFiles: () => void
  reloadAgentFiles: (agentId: string | null) => Promise<void>
  saveAgentFiles: (
    agentId: string,
    options?: { isNew?: boolean; names?: readonly AgentFileName[] }
  ) => Promise<void>
  reportAgentFileSaveError: (error: unknown, fallback: string) => void
} {
  const [agentFiles, setAgentFiles] = useState<AgentReadableFiles>(DEFAULT_AGENT_FILES)
  // Why: the on-disk copy the form was built from, keyed by agent, so a save can
  // tell deliberate edits from content an agent wrote while the form was open.
  const baselineRef = useRef<{ agentId: string; files: AgentReadableFiles } | null>(null)
  const selectedAgentIdRef = useRef<string | null>(selectedAgentId)

  const resetAgentFiles = useCallback((): void => {
    baselineRef.current = null
    setAgentFiles(DEFAULT_AGENT_FILES)
  }, [])

  const reloadAgentFiles = useCallback(
    async (agentId: string | null): Promise<void> => {
      if (!agentId) {
        resetAgentFiles()
        return
      }
      try {
        const files = await window.api.agents.readFiles(agentId)
        if (selectedAgentIdRef.current !== agentId) {
          return
        }
        baselineRef.current = { agentId, files }
        setAgentFiles(files)
      } catch (error) {
        console.error('Failed to load agent files:', error)
        toast.error('Could not load agent files')
        if (selectedAgentIdRef.current === agentId) {
          resetAgentFiles()
        }
      }
    },
    [resetAgentFiles]
  )

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId
    void reloadAgentFiles(selectedAgentId)
  }, [reloadAgentFiles, selectedAgentId])

  const saveAgentFiles = async (
    agentId: string,
    options: { isNew?: boolean; names?: readonly AgentFileName[] } = {}
  ): Promise<void> => {
    const baseline = baselineRef.current
    if (!options.isNew && baseline?.agentId !== agentId) {
      throw new Error('Agent files are not loaded yet; nothing was saved')
    }
    const files = agentFiles
    const { written, error } = await writeEditedAgentFiles({
      agentId,
      files,
      baseline: options.isNew ? null : (baseline?.files ?? null),
      names: options.names,
      write: window.api.agents.writeFile
    })
    if (baseline && baseline.agentId === agentId && !options.isNew) {
      const next = { ...baseline.files }
      for (const name of written) {
        next[name] = files[name]
      }
      baselineRef.current = { agentId, files: next }
    }
    if (error) {
      throw error
    }
    if (!options.isNew) {
      // Why: files the form did not touch may have gained agent-written content.
      await reloadAgentFiles(agentId)
    }
  }

  const reportAgentFileSaveError = (error: unknown, fallback: string): void => {
    console.error(`${fallback}:`, error)
    const agentId = selectedAgentIdRef.current
    if (isAgentFileConflictError(error) && agentId) {
      toast.error('A file changed on disk while you were editing (an agent may have written to it). It was not overwritten.', {
        action: { label: 'Load latest', onClick: () => void reloadAgentFiles(agentId) }
      })
      return
    }
    toast.error(error instanceof Error ? error.message : fallback)
  }

  return {
    agentFiles,
    setAgentFiles,
    resetAgentFiles,
    reloadAgentFiles,
    saveAgentFiles,
    reportAgentFileSaveError
  }
}
