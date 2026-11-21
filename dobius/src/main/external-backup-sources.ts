import { resolve } from 'node:path'
import { backupFolderNameFor, type ExternalBackupSource } from './external-backup-service'
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
  const folderNames = new Set<string>()

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
    const source: ExternalBackupSource = label ? { path: key, label } : { path: key }
    // Why: every source is mirrored with `rsync --delete` into a folder named
    // after its (sanitized) label or basename. Two distinct paths resolving to
    // the same folder would wipe each other's mirror every tick, so the
    // destination name is deduped too — suffixed, not dropped, so both still
    // get backed up.
    const base = backupFolderNameFor(source)
    let folder = base
    for (let n = 2; folderNames.has(folder); n += 1) {
      folder = `${base}-${n}`
    }
    folderNames.add(folder)
    sources.push(folder === base ? source : { path: key, label: folder })
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
