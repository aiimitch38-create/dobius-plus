import { resolve } from 'node:path'
import type { ExternalBackupSource } from './external-backup-service'
import type { PersistedState } from '../shared/types'

type BackupSourceInput = {
  repos: Pick<PersistedState['repos'][number], 'path' | 'displayName' | 'connectionId'>[]
  workspaceDir: string
}

/** Local repos (their in-tree worktrees come along for free) plus the shared
 *  workspace root, which is where out-of-tree worktrees are created. Remote
 *  repos are skipped: their files do not live on this machine. */
export function collectExternalBackupSources(input: BackupSourceInput): ExternalBackupSource[] {
  const sources: ExternalBackupSource[] = []
  const seen = new Set<string>()

  const push = (rawPath: string, label?: string): void => {
    const path = rawPath.trim()
    if (path.length === 0) {
      return
    }
    const key = resolve(path)
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    sources.push(label ? { path: key, label } : { path: key })
  }

  for (const repo of input.repos) {
    if (repo.connectionId) {
      continue
    }
    push(repo.path, repo.displayName)
  }
  push(input.workspaceDir, 'Workspaces')
  return sources
}
