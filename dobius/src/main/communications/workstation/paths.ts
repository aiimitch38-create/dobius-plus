// Path-safety helpers for the workstation-git feature. Every command in this
// feature accepts a renderer-supplied `reposDir` + `projectDtag` (or a bare
// `cloneUrl`) and turns it into a real filesystem path. Renderer input is
// untrusted, so every path built here is verified to stay inside its
// allowed root before any read/write touches disk (see the security note in
// the coordinator's brief: path traversal is a direct risk for this slice).
import { createHash } from 'node:crypto'
import { app } from 'electron'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Default root for cloned "project" repositories, when the caller omits reposDir. */
export function defaultWorkstationReposDir(): string {
  return join(app.getPath('userData'), 'workstation-repos')
}

/** Default root for ephemeral remote-ref snapshots keyed by clone URL. */
export function defaultWorkstationCacheDir(): string {
  return join(app.getPath('userData'), 'workstation-cache')
}

export class WorkstationPathError extends Error {}

/**
 * Resolves the configured (or default) repos directory. Must be an absolute
 * path — a renderer-supplied relative path could otherwise be interpreted
 * relative to whatever the process cwd happens to be.
 */
export function resolveReposDir(reposDir?: string | null): string {
  const dir = reposDir && reposDir.trim() ? reposDir.trim() : defaultWorkstationReposDir()
  if (!isAbsolute(dir)) {
    throw new WorkstationPathError('reposDir must be an absolute path')
  }
  return resolve(dir)
}

// Why: projectDtag becomes a directory name under reposDir. It must not be
// able to smuggle a path separator or a `..` traversal segment, and must not
// be empty/"." which would collide with reposDir itself.
const SAFE_DTAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/

export function sanitizeProjectDtag(projectDtag: string): string {
  const trimmed = projectDtag.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || !SAFE_DTAG_PATTERN.test(trimmed)) {
    throw new WorkstationPathError(`Invalid project identifier: ${JSON.stringify(projectDtag)}`)
  }
  return trimmed
}

/**
 * Joins `root` + `childName` and verifies the resolved path is actually
 * contained within `root` — the same containment check
 * (`deriveValidatedClonePath` in src/main/git/repo-clone-path.ts) uses for
 * Dobius's own clone destinations, reimplemented here because this module
 * intentionally does not depend on that file's URL-derived naming scheme.
 */
export function resolveContainedPath(root: string, childName: string): string {
  const resolvedRoot = resolve(root)
  const candidate = resolve(join(resolvedRoot, childName))
  const rel = relative(resolvedRoot, candidate)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new WorkstationPathError('Resolved path escapes its allowed root')
  }
  return candidate
}

/** Deterministic, collision-resistant, filesystem-safe cache key for a clone URL. */
export function cacheKeyForCloneUrl(cloneUrl: string): string {
  return createHash('sha256').update(cloneUrl).digest('hex')
}

/** Resolves and verifies the on-disk path for a persisted project repository. */
export function resolveProjectLocalPath(reposDir: string | null | undefined, projectDtag: string): string {
  const root = resolveReposDir(reposDir)
  return resolveContainedPath(root, sanitizeProjectDtag(projectDtag))
}

/** Resolves and verifies the on-disk path for an ephemeral clone-URL cache entry. */
export function resolveRemoteCachePath(cloneUrl: string): string {
  const root = resolve(defaultWorkstationCacheDir())
  return resolveContainedPath(root, cacheKeyForCloneUrl(cloneUrl))
}
