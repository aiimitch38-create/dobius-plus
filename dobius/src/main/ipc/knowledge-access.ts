// The knowledge cabinet's tree and file reads, shared by the window's
// `knowledge:*` IPC and the runtime RPC (`dobius knowledge tree|read`).
// Why a stricter read for the RPC: any terminal (and any agent in one) can
// reach it, so a symlink inside a knowledge root must not lead outside it, and
// files whose names look like secrets are refused even when they end in .md.
import { lstatSync, realpathSync, type Stats } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isSecretLookingPath } from '../../shared/secret-file-names'
import type { Store } from '../persistence'
import type { KnowledgeReadResult, KnowledgeTree } from '../../shared/knowledge'
import { buildKnowledgeTree, claudeDir, isAllowedKnowledgePath, safeReadFile } from './knowledge-indexer'
import { docsRoot, extractSummary } from './knowledge-leaf-sources'

const MAX_PATH_CHARS = 4096

/** What the window's Knowledge view shows (`knowledge:tree`). */
export function knowledgeTree(store: Store): KnowledgeTree {
  return buildKnowledgeTree(store)
}

/** The `knowledge:read` IPC behaviour: any .md file under a knowledge root. */
export function readKnowledgeFile(store: Store, filePath: unknown): KnowledgeReadResult {
  if (typeof filePath !== 'string' || !isAllowedKnowledgePath(filePath, store)) {
    throw new Error('Path is outside the knowledge roots.')
  }
  const content = safeReadFile(filePath)
  if (content === null) {
    throw new Error('Could not read the knowledge file.')
  }
  return { content, filePath }
}

export function knowledgeRoots(store: Store): string[] {
  return [claudeDir(), docsRoot(), ...store.getRepos().map((repo) => repo.path)]
}

function realOrNull(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

function within(root: string, path: string): string | null {
  const rel = relative(root, path)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : null
}

type CheckedKnowledgePath = { path: string; root: string; parts: string[] }

/**
 * Where a knowledge file the runtime RPC may show lives. It must be a .md file
 * under a knowledge root (the root itself may be a symlink, as configured),
 * and no part of it below that root may look like a secret. Throws a
 * plain-English reason otherwise. Symlinks are checked at read time.
 */
function checkKnowledgePath(filePath: unknown, roots: string[]): CheckedKnowledgePath {
  if (typeof filePath !== 'string' || !filePath || filePath.length > MAX_PATH_CHARS) {
    throw new Error('Give the full path of a knowledge file.')
  }
  if (!isAbsolute(filePath)) {
    throw new Error('Give the full path of a knowledge file (as `dobius knowledge tree` lists it).')
  }
  const resolved = resolve(filePath)
  if (!resolved.toLowerCase().endsWith('.md')) {
    throw new Error('Only Markdown (.md) knowledge files can be read.')
  }
  for (const root of roots) {
    const realRoot = realOrNull(resolve(root))
    if (!realRoot) {
      continue
    }
    const rel = within(resolve(root), resolved) ?? within(realRoot, resolved)
    if (!rel) {
      continue
    }
    const parts = rel.split(sep)
    // Same names the agent file guard refuses (shared/secret-file-names.ts),
    // applied to every folder below the root too, so `secrets/notes.md` is out.
    if (parts.some((_, index) => isSecretLookingPath(parts.slice(0, index + 1).join('/')))) {
      throw new Error('That file looks like it holds secrets, so it is not read here.')
    }
    return { path: join(realRoot, ...parts), root: realRoot, parts }
  }
  throw new Error('Path is outside the knowledge roots.')
}

/** lstat of every step below the root; null when one is a symlink or missing. */
function lstatChainWithoutLinks(checked: CheckedKnowledgePath): Stats | null {
  let current = checked.root
  let last: Stats | null = null
  for (const part of checked.parts) {
    current = join(current, part)
    try {
      last = lstatSync(current)
    } catch {
      return null
    }
    if (last.isSymbolicLink()) {
      return null
    }
  }
  return last
}

/**
 * Reads a checked knowledge file. Why this order: the folders are checked for
 * symlinks, the file is opened without following one, and the opened file
 * must be the very file checked (same dev/ino, and the chain still has no
 * symlink afterwards), so swapping in a link mid-read leads nowhere.
 */
function guardedRead(checked: CheckedKnowledgePath): string | null {
  const before = lstatChainWithoutLinks(checked)
  if (!before || !before.isFile()) {
    return null
  }
  const content = safeReadFile(checked.path, undefined, (opened) => {
    const after = lstatChainWithoutLinks(checked)
    return (
      opened.dev === before.dev &&
      opened.ino === before.ino &&
      after !== null &&
      after.dev === before.dev &&
      after.ino === before.ino
    )
  })
  return content
}

/** Reads a knowledge file for the runtime RPC (see checkKnowledgePath, guardedRead). */
export function readKnowledgeFileWithin(filePath: unknown, roots: string[]): KnowledgeReadResult {
  const checked = checkKnowledgePath(filePath, roots)
  const content = guardedRead(checked)
  if (content === null) {
    throw new Error(
      'Could not read the knowledge file (missing, a link, not a plain file, or larger than 512 KB).'
    )
  }
  return { content, filePath: filePath as string }
}

// Set when the window's knowledge handlers register; the runtime RPC reads the
// same store (the repo list decides which project folders count as roots).
let registeredStore: Store | null = null

export function setKnowledgeStore(store: Store | null): void {
  registeredStore = store
}

function requireStore(): Store {
  if (!registeredStore) {
    throw new Error('Knowledge is not ready yet. Open the Dobius+ window and try again.')
  }
  return registeredStore
}

/** The leaf's content through the guarded read, or null when it may not be shown. */
function showableContent(filePath: string, roots: string[]): string | null {
  try {
    return guardedRead(checkKnowledgePath(filePath, roots))
  } catch {
    return null
  }
}

/**
 * The tree with only the files `knowledge read` would show, each summary
 * taken again from that guarded read. Why: the indexer's own summaries come
 * from an unguarded read, so they could quote a secret-looking file or one
 * reached through a symlink.
 */
export function filterKnowledgeTree(tree: KnowledgeTree, roots: string[]): KnowledgeTree {
  return {
    ...tree,
    branches: tree.branches.map((branch) => {
      const leaves = branch.leaves.flatMap((leaf) => {
        const content = showableContent(leaf.filePath, roots)
        return content === null ? [] : [{ ...leaf, summary: extractSummary(content) }]
      })
      const kept = new Set(leaves.map((leaf) => leaf.id))
      return {
        ...branch,
        leaves: leaves.map((leaf) => ({ ...leaf, links: leaf.links.filter((id) => kept.has(id)) })),
        groups: branch.groups.map((group) => ({
          ...group,
          leafIds: group.leafIds.filter((id) => kept.has(id))
        }))
      }
    })
  }
}

export function knowledgeTreeForRuntime(): KnowledgeTree {
  const store = requireStore()
  return filterKnowledgeTree(knowledgeTree(store), knowledgeRoots(store))
}

export function readKnowledgeFileForRuntime(filePath: unknown): KnowledgeReadResult {
  return readKnowledgeFileWithin(filePath, knowledgeRoots(requireStore()))
}
