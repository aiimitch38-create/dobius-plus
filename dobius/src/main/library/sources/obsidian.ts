// The Obsidian vault (~/Obsidian Vault/**/*.md). The project is the note's
// top folder in the vault, e.g. "AI Research"; .obsidian and .trash are skipped.
import { relative, sep } from 'node:path'
import type { LibraryIngester } from '../library-types'
import { markdownCandidates, walkFiles } from './fs-walk'
import { realRoot } from './safe-path'

export function obsidianIngester(vaultRoot: string): LibraryIngester {
  return {
    source: 'obsidian',
    list: async () => {
      const base = await realRoot(vaultRoot)
      if (!base) {
        return []
      }
      const files = await walkFiles(base, {
        maxDepth: 10,
        maxDirs: 5000,
        wantFile: (path) => path.toLowerCase().endsWith('.md')
      })
      return markdownCandidates('obsidian', base, files, (file) => {
        const parts = relative(base, file).split(sep)
        return parts.length > 1 ? parts[0] : 'Obsidian'
      })
    }
  }
}
