// Project notes: plans, CLAUDE.md, handoffs, build logs, lessons, notes,
// READMEs and docs/ under each top-level folder of ~/Projects (Code). No
// source code. A repository checked out in several worktrees is read once.
import { lstat, readdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { LibraryIngester } from '../library-types'
import { markdownCandidates, projectForPath, walkFiles } from './fs-walk'

const NOTE_FILE =
  /^(?:CLAUDE|HANDOFF[^/]*|BUILD-LOG[^/]*|LESSONS-LEARNED|NOTES|README[^/]*)\.md$/i

const NOTES_FOLDER = /^(?:plans|docs)$/i

/** True for a project notes file, by its path relative to the project folder. */
export function isProjectNotesFile(relativePath: string): boolean {
  if (!relativePath.toLowerCase().endsWith('.md')) {
    return false
  }
  const parts = relativePath.split('/')
  const name = parts.at(-1)!
  return (
    NOTE_FILE.test(name) || parts.slice(0, -1).some((part) => NOTES_FOLDER.test(part))
  )
}

/** The repository's shared git folder for a checkout, or null when it is not one. */
export async function gitCommonDir(dir: string): Promise<{ common: string; linked: boolean } | null> {
  const dotGit = join(dir, '.git')
  let info
  try {
    info = await lstat(dotGit)
  } catch {
    return null
  }
  if (info.isDirectory()) {
    return { common: resolve(dotGit), linked: false }
  }
  if (!info.isFile()) {
    return null
  }
  try {
    const pointer = /^gitdir:\s*(.+)$/m.exec(await readFile(dotGit, 'utf8'))?.[1]?.trim()
    if (!pointer) {
      return null
    }
    const gitDir = isAbsolute(pointer) ? pointer : resolve(dir, pointer)
    const commonFile = await readFile(join(gitDir, 'commondir'), 'utf8').catch(() => '../..')
    return { common: resolve(gitDir, commonFile.trim()), linked: true }
  } catch {
    return null
  }
}

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !isAbsolute(rel))
}

/**
 * Decides once per checkout whether to walk it. Why: Dobius alone has a dozen
 * worktrees with the same plans. The main checkout wins when it lives under
 * the projects root; otherwise the first worktree seen does.
 */
function checkoutFilter(projectsRoot: string): (dir: string) => Promise<boolean> {
  const taken = new Set<string>()
  return async (dir) => {
    const git = await gitCommonDir(dir)
    if (!git) {
      return true
    }
    const mainRoot = dirname(git.common)
    if (git.linked && isInside(mainRoot, projectsRoot)) {
      return false
    }
    if (taken.has(git.common)) {
      return false
    }
    taken.add(git.common)
    return true
  }
}

export function projectDocsIngester(projectsRoot: string): LibraryIngester {
  return {
    source: 'project',
    list: async () => {
      let entries
      try {
        entries = await readdir(projectsRoot, { withFileTypes: true })
      } catch {
        return []
      }
      const enter = checkoutFilter(projectsRoot)
      const files: string[] = []
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue
        }
        const top = join(projectsRoot, entry.name)
        if (!(await enter(top))) {
          continue
        }
        files.push(
          ...(await walkFiles(top, {
            maxDepth: 7,
            maxDirs: 4000,
            allowHidden: new Set(['.dobius', '.claude']),
            enterDir: enter,
            // Why: a top-level Docs or plans folder is notes all the way down.
            wantFile: NOTES_FOLDER.test(entry.name)
              ? (path) => path.toLowerCase().endsWith('.md')
              : isProjectNotesFile
          }))
        )
      }
      return markdownCandidates('project', files, (file) => projectForPath(file, projectsRoot))
    }
  }
}
