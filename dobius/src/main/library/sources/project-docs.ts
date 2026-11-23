// Project notes: plans, CLAUDE.md, handoffs, build logs, lessons, notes,
// READMEs and docs/ under each top-level folder of ~/Projects (Code). No
// source code. Every worktree is read; copies shared between worktrees of
// one repository count once (project-checkouts.ts).
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { LibraryIngester } from '../library-types'
import { isSkippedDirName } from '../library-secrets'
import { markdownCandidates, projectForPath, walkFiles } from './fs-walk'
import { realRoot } from './safe-path'
import type { Checkout, CheckoutFile } from './project-checkouts'
import { checkoutLabels, dedupeAcrossCheckouts } from './project-checkouts'

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
    return { common: await realpath(dotGit).catch(() => resolve(dotGit)), linked: false }
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
    const common = resolve(gitDir, commonFile.trim())
    // Why realpath: the pointer may name the repository through a link.
    return { common: await realpath(common).catch(() => common), linked: true }
  } catch {
    return null
  }
}

/**
 * Notes files of every checkout under one top-level folder. A nested git
 * checkout (a worktree inside the folder) is walked on its own, with its own
 * directory budget, so each file knows which checkout it came from.
 */
async function topFolderFiles(top: string, wantFile: (path: string) => boolean): Promise<CheckoutFile[]> {
  const git = await gitCommonDir(top)
  const pending: Checkout[] = [{ root: top, common: git?.common ?? null, linked: git?.linked ?? false }]
  const files: CheckoutFile[] = []
  while (pending.length > 0) {
    const checkout = pending.shift()!
    const found = await walkFiles(checkout.root, {
      maxDepth: 7,
      maxDirs: 4000,
      allowHidden: new Set(['.dobius', '.claude']),
      enterDir: async (dir) => {
        const nested = await gitCommonDir(dir)
        if (!nested) {
          return true
        }
        pending.push({ root: dir, common: nested.common, linked: nested.linked })
        return false
      },
      wantFile
    })
    files.push(...found.map((path) => ({ checkout, path })))
  }
  return files
}

export function projectDocsIngester(projectsRoot: string): LibraryIngester {
  return {
    source: 'project',
    list: async () => {
      const base = await realRoot(projectsRoot)
      if (!base) {
        return []
      }
      let entries
      try {
        entries = await readdir(base, { withFileTypes: true })
      } catch {
        return []
      }
      const files: CheckoutFile[] = []
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || isSkippedDirName(entry.name)) {
          continue
        }
        files.push(
          ...(await topFolderFiles(
            join(base, entry.name),
            // Why: a top-level Docs or plans folder is notes all the way down.
            NOTES_FOLDER.test(entry.name)
              ? (path) => path.toLowerCase().endsWith('.md')
              : isProjectNotesFile
          ))
        )
      }
      const kept = await dedupeAcrossCheckouts(files)
      const labels = checkoutLabels(files)
      return markdownCandidates(
        'project',
        base,
        kept.map((file) => file.path),
        (file) => projectForPath(file, base),
        (file) => labels.get(file) ?? null
      )
    }
  }
}
