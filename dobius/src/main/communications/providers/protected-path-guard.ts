import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

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

// Why: APFS (macOS default) and NTFS are case-insensitive, so `~/.SSH` opens the
// same folder as `~/.ssh` — a case-sensitive containment check is bypassed by
// changing one letter.
const CASE_INSENSITIVE_PATHS = process.platform === 'darwin' || process.platform === 'win32'

/** Folds a path to the form two paths should be compared in on this platform. */
export function comparablePath(value: string): string {
  return CASE_INSENSITIVE_PATHS ? value.toLowerCase() : value
}

function isWithin(root: string, candidate: string): boolean {
  const rootKey = comparablePath(root)
  const candidateKey = comparablePath(candidate)
  if (candidateKey === rootKey) {
    return true
  }
  return candidateKey.startsWith(rootKey.endsWith(sep) ? rootKey : `${rootKey}${sep}`)
}

function realpathIfPresent(target: string): string | null {
  if (!existsSync(target)) {
    return null
  }
  try {
    return realpathSync(target)
  } catch (error) {
    // Why: an entry that exists but cannot be resolved (permission, symlink
    // loop) is treated like a missing one, so its parent gets resolved instead.
    if (error instanceof Error && 'code' in error) {
      return null
    }
    throw error
  }
}

/**
 * Resolves the deepest ancestor that exists, then re-appends the not-yet-existing
 * tail, so a path whose leaf has not been created yet still gets its real parent
 * checked. Why the tail: dropping it would turn a missing root (no ~/.gnupg)
 * into its parent — the home folder — and refuse every path under home.
 */
export function realpathPreservingMissingTail(target: string): string {
  let current = resolve(target)
  const missing: string[] = []
  // Why existsSync first: realpathSync throws for every missing level, and a
  // thrown error per level made a many-path command cost seconds on the main
  // thread (the agent hard-rail hook calls this synchronously).
  for (;;) {
    const real = realpathIfPresent(current)
    if (real !== null) {
      return join(real, ...missing)
    }
    const parent = dirname(current)
    if (parent === current) {
      return resolve(target)
    }
    missing.unshift(basename(current))
    current = parent
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

  const realResolved = realpathPreservingMissingTail(resolved)
  for (const root of protectedRoots) {
    if (isWithin(realpathPreservingMissingTail(root), realResolved)) {
      throw new ProtectedPathError(candidatePath)
    }
  }
}
