import { lstat, open, readdir } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { isSecretOrSkippedPath, isSkippedDirName } from '../library-secrets'
import type { LibraryCandidate, LibraryDocument, LibrarySource } from '../library-types'
import { realRoot, safeFile } from './safe-path'

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

/**
 * Files under root the caller wants, as real paths under the root's real
 * path. Symlinked folders and files are never followed (Dirent types do not
 * follow links), and a root that resolves into a skipped folder yields nothing.
 */
export async function walkFiles(root: string, options: WalkOptions): Promise<string[]> {
  const base = await realRoot(root)
  if (!base) {
    return []
  }
  const found: string[] = []
  const queue: { dir: string; depth: number }[] = [{ dir: base, depth: 0 }]
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
        if (!hidden && !isSkippedDirName(entry.name) && depth < options.maxDepth) {
          queue.push({ dir: full, depth: depth + 1 })
        }
      } else if (entry.isFile() && !isSecretOrSkippedPath(full)) {
        if (options.wantFile(relative(base, full).split(sep).join('/'))) {
          found.push(full)
        }
      }
    }
  }
  return found
}

/** Markdown files are capped so one huge export does not fill the index. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024

export function isEligibleSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_BYTES
}

/** At most maxBytes of a file, as text; a file that grew past the cap is cut. */
export async function readTextCapped(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** Stat each file into a candidate that reads it as one markdown document. */
export async function markdownCandidates(
  source: LibrarySource,
  root: string,
  files: string[],
  project: (file: string) => string | null,
  /** A folder name shown with the file name, e.g. the worktree it came from. */
  label: (file: string) => string | null = () => null
): Promise<LibraryCandidate[]> {
  const base = await realRoot(root)
  if (!base) {
    return []
  }
  const candidates: LibraryCandidate[] = []
  for (const file of files) {
    const info = await lstat(file).catch(() => null)
    if (!info || !info.isFile() || !isEligibleSize(info.size)) {
      continue
    }
    candidates.push({
      key: `${source}:${file}`,
      source,
      path: file,
      mtimeMs: info.mtimeMs,
      size: info.size,
      load: async (): Promise<LibraryDocument | null> => {
        // Why again at read time: the file may have been swapped for a link.
        const real = await safeFile(file, base)
        if (!real) {
          return null
        }
        const text = await readTextCapped(real, MAX_FILE_BYTES)
        return {
          project: project(file),
          title: markdownTitle(text, [label(file), basename(file)].filter(Boolean).join('/')),
          sections: [{ text, at: info.mtimeMs }]
        }
      }
    })
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
