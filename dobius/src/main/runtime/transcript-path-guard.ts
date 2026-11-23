import { constants } from 'node:fs'
import { open, realpath, stat, type FileHandle } from 'node:fs/promises'
import { extname, isAbsolute, relative, sep } from 'node:path'

// Why: the transcript path comes from an agent hook payload, which any local
// process can post. terminal.read must not become a way to read arbitrary
// files, so it only opens a regular .jsonl file whose canonical path is inside
// the agent's own session folders, and checks the opened descriptor itself so
// a symlink swapped in between the check and the open is caught.

export type ConfinedFile = { handle: FileHandle; canonicalPath: string; size: number }

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel.length > 0 && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export async function openConfinedTranscriptFile(
  path: string,
  roots: readonly string[]
): Promise<ConfinedFile | { reason: string }> {
  if (!isAbsolute(path) || extname(path) !== '.jsonl') {
    return { reason: 'transcript path is not an absolute .jsonl path' }
  }
  let canonicalPath: string
  try {
    canonicalPath = await realpath(path)
  } catch {
    return { reason: 'transcript file not found' }
  }
  const canonicalRoots = (
    await Promise.all(roots.map((root) => realpath(root).catch(() => null)))
  ).filter((root): root is string => root !== null)
  if (!canonicalRoots.some((root) => isInside(root, canonicalPath))) {
    return { reason: 'transcript path is outside the agent session folders' }
  }
  let handle: FileHandle
  try {
    handle = await open(canonicalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (err) {
    return { reason: `transcript unreadable: ${err instanceof Error ? err.message : String(err)}` }
  }
  try {
    const opened = await handle.stat()
    if (!opened.isFile()) {
      await handle.close()
      return { reason: 'transcript is not a regular file' }
    }
    const again = await realpath(canonicalPath)
    const current = await stat(again)
    if (again !== canonicalPath || current.dev !== opened.dev || current.ino !== opened.ino) {
      await handle.close()
      return { reason: 'transcript path changed while it was being opened' }
    }
    return { handle, canonicalPath, size: opened.size }
  } catch (err) {
    await handle.close()
    return { reason: `transcript unreadable: ${err instanceof Error ? err.message : String(err)}` }
  }
}
