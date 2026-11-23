// Where each source lives. No Electron import: the refresh worker uses this.
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LibraryIngester } from './library-types'
import { adamIngester } from './sources/adam'
import { claudeConversationsIngester } from './sources/claude-conversations'
import { codexConversationsIngester } from './sources/codex-conversations'
import { obsidianIngester } from './sources/obsidian'
import { projectDocsIngester } from './sources/project-docs'

export type LibraryRoots = {
  projectsRoot: string
  claudeProjectsDir: string
  codexSessionsDir: string
  adamThreadFile: string
  hermesStateDb: string
  obsidianVault: string
}

export function defaultLibraryRoots(userData: string, home = homedir()): LibraryRoots {
  return {
    projectsRoot: join(home, 'Projects (Code)'),
    claudeProjectsDir: join(home, '.claude', 'projects'),
    codexSessionsDir: join(home, '.codex', 'sessions'),
    adamThreadFile: join(userData, 'adam-thread.json'),
    hermesStateDb: join(home, '.hermes', 'profiles', 'adam', 'state.db'),
    obsidianVault: join(home, 'Obsidian Vault')
  }
}

export function libraryIngesters(roots: LibraryRoots): LibraryIngester[] {
  return [
    projectDocsIngester(roots.projectsRoot),
    claudeConversationsIngester(roots.claudeProjectsDir, roots.projectsRoot),
    codexConversationsIngester(roots.codexSessionsDir, roots.projectsRoot),
    adamIngester({ threadFile: roots.adamThreadFile, hermesStateDb: roots.hermesStateDb }),
    obsidianIngester(roots.obsidianVault)
  ]
}
