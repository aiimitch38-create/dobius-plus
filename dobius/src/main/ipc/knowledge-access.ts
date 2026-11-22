// The knowledge cabinet's tree and file reads, shared by the window's
// `knowledge:*` IPC and the runtime RPC (`dobius knowledge tree|read`).
// Why a stricter read for the RPC: any terminal (and any agent in one) can
// reach it, so a symlink inside a knowledge root must not lead outside it, and
// files whose names look like secrets are refused even when they end in .md.
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { isSecretLookingPath } from '../../shared/secret-file-names'
import type { Store } from '../persistence'
import type { KnowledgeReadResult, KnowledgeTree } from '../../shared/knowledge'
import { buildKnowledgeTree, claudeDir, isAllowedKnowledgePath, safeReadFile } from './knowledge-indexer'
import { docsRoot } from './knowledge-leaf-sources'

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

/**
 * Reads a knowledge file for the runtime RPC. The real path (symlinks
 * followed) must be a .md file inside the real path of a knowledge root, and
 * no part of it below that root may look like a secret.
 */
export function readKnowledgeFileWithin(filePath: unknown, roots: string[]): KnowledgeReadResult {
  if (typeof filePath !== 'string' || !filePath || filePath.length > MAX_PATH_CHARS) {
    throw new Error('Give the full path of a knowledge file.')
  }
  if (!isAbsolute(filePath)) {
    throw new Error('Give the full path of a knowledge file (as `dobius knowledge tree` lists it).')
  }
  const real = realOrNull(resolve(filePath))
  if (!real) {
    throw new Error('Could not read the knowledge file.')
  }
  if (!real.toLowerCase().endsWith('.md')) {
    throw new Error('Only Markdown (.md) knowledge files can be read.')
  }
  let below: string | null = null
  for (const root of roots) {
    const realRoot = realOrNull(resolve(root))
    const rel = realRoot ? within(realRoot, real) : null
    if (rel) {
      below = rel
      break
    }
  }
  if (!below) {
    throw new Error('Path is outside the knowledge roots.')
  }
  // Same names the agent file guard refuses (shared/secret-file-names.ts),
  // applied to every folder below the root too, so `secrets/notes.md` is out.
  const parts = below.split(sep)
  if (parts.some((_, index) => isSecretLookingPath(parts.slice(0, index + 1).join('/')))) {
    throw new Error('That file looks like it holds secrets, so it is not read here.')
  }
  const content = safeReadFile(real)
  if (content === null) {
    throw new Error('Could not read the knowledge file (missing, or larger than 512 KB).')
  }
  return { content, filePath }
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

export function knowledgeTreeForRuntime(): KnowledgeTree {
  return knowledgeTree(requireStore())
}

export function readKnowledgeFileForRuntime(filePath: unknown): KnowledgeReadResult {
  return readKnowledgeFileWithin(filePath, knowledgeRoots(requireStore()))
}
