import type { KnowledgeTree } from '../../../../../shared/knowledge'

export type MemoryNote = {
  id: string
  title: string
  summary: string
  filePath: string
  branchLabel: string
}

export type MemoryNoteSplit = { repo: MemoryNote[]; global: MemoryNote[] }

// Knowledge branches that hold facts and context (skills/docs live in their own studios).
const NOTE_BRANCH_IDS = new Set(['memory', 'lessons', 'projects', 'rules'])

// ponytail: cap keeps a bracketed paste into the agent sane; the path lets it read the rest.
export const MEMORY_PUSH_MAX_CHARS = 8000

function toSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Claude CLI's per-project folder name under ~/.claude/projects (every non-alphanumeric becomes '-'). */
export function claudeProjectDirName(projectPath: string): string {
  return toSlashes(projectPath).replace(/[^a-zA-Z0-9]/g, '-')
}

function belongsToProject(filePath: string, roots: readonly string[]): boolean {
  const file = toSlashes(filePath)
  return roots.some((root) => {
    const normalized = toSlashes(root)
    if (!normalized) {
      return false
    }
    return (
      file.startsWith(`${normalized}/`) ||
      file.includes(`/projects/${claudeProjectDirName(normalized)}/memory/`)
    )
  })
}

/**
 * Splits knowledge notes into the ones for this project (files inside the repo or
 * worktree, or Claude memory recorded for those folders) and global ones.
 */
export function splitKnowledgeNotes(
  tree: KnowledgeTree,
  projectRoots: readonly string[]
): MemoryNoteSplit {
  const split: MemoryNoteSplit = { repo: [], global: [] }
  const seen = new Set<string>()
  for (const branch of tree.branches) {
    if (!NOTE_BRANCH_IDS.has(branch.id)) {
      continue
    }
    for (const leaf of branch.leaves) {
      if (seen.has(leaf.filePath)) {
        continue
      }
      seen.add(leaf.filePath)
      const note: MemoryNote = {
        id: leaf.id,
        title: leaf.title,
        summary: leaf.summary,
        filePath: leaf.filePath,
        branchLabel: branch.label
      }
      split[belongsToProject(leaf.filePath, projectRoots) ? 'repo' : 'global'].push(note)
    }
  }
  return split
}

/** Prompt text sent to a console when the user pushes a memory note into it. */
export function buildMemoryPushPrompt(note: {
  title: string
  filePath: string
  content: string
}): string {
  const body = note.content.trim()
  const clipped =
    body.length > MEMORY_PUSH_MAX_CHARS
      ? `${body.slice(0, MEMORY_PUSH_MAX_CHARS)}\n\n[Truncated. Read the full note at ${note.filePath}]`
      : body
  return `Use this memory note as context: "${note.title}" (${note.filePath})\n\n${clipped}`
}
