import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { isSecretOrSkippedPath, LIBRARY_SKIPPED_DIRS } from '../library-secrets'
import type { LibraryCandidate, LibraryDocument, LibrarySource } from '../library-types'

export type WalkOptions = {
  maxDepth: number
  /** Directory budget per walk, so one giant tree cannot stall a pass. */
  maxDirs: number
  /** Hidden folders that may be entered (all others are skipped). */
  allowHidden?: ReadonlySet<string>
  /** Return false to skip a directory and everything under it. */
  enterDir?: (dir: string) => Promise<boolean>
  wantFile: (relativePath: string) => boolean
}

/** Files under root the caller wants. Symlinks are never followed. */
export async function walkFiles(root: string, options: WalkOptions): Promise<string[]> {
  const found: string[] = []
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < options.maxDirs) {
    const { dir, depth } = queue.shift()!
    visited += 1
    if (depth > 0 && options.enterDir && !(await options.enterDir(dir))) {
      continue
    }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        const hidden = entry.name.startsWith('.') && !options.allowHidden?.has(entry.name)
        if (!hidden && !LIBRARY_SKIPPED_DIRS.has(entry.name) && depth < options.maxDepth) {
          queue.push({ dir: full, depth: depth + 1 })
        }
      } else if (entry.isFile() && !isSecretOrSkippedPath(full)) {
        if (options.wantFile(relative(root, full).split(sep).join('/'))) {
          found.push(full)
        }
      }
    }
  }
  return found
}

/** Markdown files are capped so one huge export does not fill the index. */
const MAX_FILE_BYTES = 2 * 1024 * 1024

/** Stat each file into a candidate that reads it as one markdown document. */
export async function markdownCandidates(
  source: LibrarySource,
  files: string[],
  project: (file: string) => string | null
): Promise<LibraryCandidate[]> {
  const candidates: LibraryCandidate[] = []
  for (const file of files) {
    try {
      const info = await stat(file)
      if (info.size === 0 || info.size > MAX_FILE_BYTES) {
        continue
      }
      candidates.push({
        key: `${source}:${file}`,
        source,
        path: file,
        mtimeMs: info.mtimeMs,
        size: info.size,
        load: async (): Promise<LibraryDocument> => {
          const text = await readFile(file, 'utf8')
          return {
            project: project(file),
            title: markdownTitle(text, basename(file)),
            sections: [{ text, at: info.mtimeMs }]
          }
        }
      })
    } catch {
      // Gone between listing and stat: the next pass will not see it either.
      continue
    }
  }
  return candidates
}

function markdownTitle(text: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(text.slice(0, 4000))?.[1]?.trim()
  return heading ? `${heading.slice(0, 100)} (${fallback})` : fallback
}

/** The project a working folder belongs to: its top-level folder under the projects root. */
export function projectForPath(path: string, projectsRoot: string): string | null {
  const rel = relative(projectsRoot, path)
  if (rel && !rel.startsWith('..') && !rel.startsWith(sep)) {
    return rel.split(sep)[0] || null
  }
  return basename(path) || null
}
