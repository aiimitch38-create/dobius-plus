import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'

/**
 * Directories a provider must never be pointed at. All credential or identity
 * stores, so a mistyped working directory cannot put an agent on top of them.
 *
 * ponytail: homedir-relative only, which keeps this module free of Electron and
 * testable. Electron's userData path belongs here too — add it at the call site
 * if a provider ever needs that covered.
 */
export function protectedProviderRoots(): string[] {
  const home = homedir()
  return [
    join(home, '.dobius'),
    join(home, '.ssh'),
    join(home, '.claude'),
    join(home, '.codex'),
    join(home, '.aws'),
    join(home, '.gnupg')
  ]
}

/**
 * Refuses provider file operations that land inside a protected root.
 *
 * Why the realpath pass: resolving the literal path only proves where the
 * string points. A symlink inside an allowed directory can still aim at a
 * protected one, so the deepest existing ancestor is resolved too and checked
 * again — a containment check that skips this is bypassed by one `ln -s`.
 */
export class ProtectedPathError extends Error {
  constructor(readonly attemptedPath: string) {
    super(`Path is inside a protected location and was refused: ${attemptedPath}`)
    this.name = 'ProtectedPathError'
  }
}

function isWithin(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true
  }
  return candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

/**
 * Resolves the deepest ancestor that exists, so a path whose leaf has not been
 * created yet still gets its real parent checked.
 */
function realpathNearestExisting(target: string): string {
  let current = resolve(target)
  for (;;) {
    try {
      return realpathSync(current)
    } catch {
      const parent = resolve(current, '..')
      if (parent === current) {
        return current
      }
      current = parent
    }
  }
}

export function assertPathOutsideProtectedRoots(
  protectedRoots: readonly string[],
  candidatePath: string,
  baseDir: string
): void {
  if (protectedRoots.length === 0) {
    return
  }
  const resolved = isAbsolute(candidatePath)
    ? resolve(candidatePath)
    : resolve(baseDir, candidatePath)

  for (const root of protectedRoots) {
    if (isWithin(resolve(root), resolved)) {
      throw new ProtectedPathError(candidatePath)
    }
  }

  const realResolved = realpathNearestExisting(resolved)
  for (const root of protectedRoots) {
    if (isWithin(realpathNearestExisting(root), realResolved)) {
      throw new ProtectedPathError(candidatePath)
    }
  }
}
