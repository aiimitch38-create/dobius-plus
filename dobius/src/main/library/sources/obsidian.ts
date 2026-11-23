// The Obsidian vault (~/Obsidian Vault/**/*.md). The project is the note's
// top folder in the vault, e.g. "AI Research"; .obsidian and .trash are skipped.
import { relative, sep } from 'node:path'
import type { LibraryIngester } from '../library-types'
import { markdownCandidates, walkFiles } from './fs-walk'

export function obsidianIngester(vaultRoot: string): LibraryIngester {
  return {
    source: 'obsidian',
    list: async () => {
      const files = await walkFiles(vaultRoot, {
        maxDepth: 10,
        maxDirs: 5000,
        wantFile: (path) => path.toLowerCase().endsWith('.md')
      })
      return markdownCandidates('obsidian', files, (file) => {
        const parts = relative(vaultRoot, file).split(sep)
        return parts.length > 1 ? parts[0] : 'Obsidian'
      })
    }
  }
}
