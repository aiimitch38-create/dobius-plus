// Where the library may read. Why realpath: a root or a file can be a symlink
// into a vendor tree or a secrets folder, and the name-based denylist only
// sees the link's own path. Every read goes through safeFile first.
import { constants } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { isSecretOrSkippedPath } from '../library-secrets'

export function isInside(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** The root's real path, or null when it is missing or resolves into a skipped folder. */
export async function realRoot(root: string): Promise<string | null> {
  try {
    const real = await realpath(root)
    // Why the child name: the check looks at folders above a file.
    return isSecretOrSkippedPath(join(real, 'x')) ? null : real
  } catch {
    return null
  }
}

/**
 * The real path of a regular, non-symlink file inside realRootPath that is
 * not a secret file, or null.
 */
export async function safeFile(path: string, realRootPath: string): Promise<string | null> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile()) {
      return null
    }
    const real = await realpath(path)
    if (!isInside(real, realRootPath) || isSecretOrSkippedPath(real)) {
      return null
    }
    return real
  } catch {
    return null
  }
}

/**
 * An open handle on a file that passes safeFile, or null. Why open, then
 * check: a folder above the file can be swapped between a check and an open.
 * The file is opened without following a final link, then the path is checked
 * again and must still name the very file that was opened (same device and
 * inode); every read then goes through the handle, never the path.
 */
export async function openSafe(path: string, realRootPath: string): Promise<FileHandle | null> {
  let handle: FileHandle | null = null
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = await handle.stat()
    const real = opened.isFile() ? await safeFile(path, realRootPath) : null
    const named = real ? await stat(real) : null
    if (named && named.dev === opened.dev && named.ino === opened.ino) {
      return handle
    }
  } catch {
    // Missing, a link, or unreadable: refused like any other unsafe file.
  }
  await handle?.close().catch(() => undefined)
  return null
}
