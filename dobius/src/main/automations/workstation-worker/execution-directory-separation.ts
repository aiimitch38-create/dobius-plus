import { statSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'

type EnrolledDirectories = {
  roots: readonly { canonicalPath: string }[]
  worktrees: readonly { canonicalPath: string }[]
  profiles: readonly { home: string }[]
}

/** Credential homes and source checkouts must remain separate at launch as well as enrollment. */
export function assertExecutionDirectorySeparation(registry: EnrolledDirectories): void {
  const identify = (path: string) => {
    const stat = statSync(path, { bigint: true })
    if (!stat.isDirectory()) {
      throw new Error('Enrolled execution directory is unavailable.')
    }
    return `${stat.dev}:${stat.ino}`
  }
  const roots = new Set(registry.roots.map((root) => identify(root.canonicalPath)))
  for (const worktree of registry.worktrees) {
    if (roots.has(identify(worktree.canonicalPath))) {
      throw new Error('Execution worktrees must be distinct from enrolled origin roots.')
    }
  }
  const sources = [...registry.roots, ...registry.worktrees].map(({ canonicalPath }) => ({
    path: canonicalPath,
    identity: identify(canonicalPath)
  }))
  for (const profile of registry.profiles) {
    const home = identify(profile.home)
    if (
      sources.some(
        (source) =>
          home === source.identity ||
          contains(profile.home, source.path) ||
          contains(source.path, profile.home)
      )
    ) {
      throw new Error('Credential homes must not overlap enrolled source directories.')
    }
  }
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path.split(sep)[0] !== '..')
}
