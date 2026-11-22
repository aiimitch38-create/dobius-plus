// Path facts the postcheck sandbox needs: every spelling of each sign-in
// folder, and where `.env` symlinks in the run folder really point.

import { existsSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'

// Folders and files under home that hold sign-in material or app secrets.
const HOME_SECRET_PATHS = [
  '.ssh',
  '.aws',
  '.config',
  '.gnupg',
  '.docker',
  '.kube',
  '.claude',
  '.claude.json',
  '.codex',
  '.dobius',
  '.netrc',
  '.npmrc',
  '.git-credentials',
  'Library/Keychains',
  'Library/Cookies',
  'Library/Messages'
]

// Every folder is walked (a link at any depth counts); past this many entries
// the scan gives up and the check does not run.
const ENV_SCAN_MAX_ENTRIES = 50_000
const ENV_SCAN_SKIPPED_DIRS = new Set(['node_modules', '.git'])

export function isWithin(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * The path with every symlink resolved. For a path that does not exist yet,
 * the nearest existing folder above it is resolved and the rest appended, so a
 * rule still names where the path would really be.
 */
export function resolveThroughExisting(target: string): string {
  const absolute = path.resolve(target)
  const tail: string[] = []
  let current = absolute
  while (!existsSync(current) && current !== path.dirname(current)) {
    tail.unshift(path.basename(current))
    current = path.dirname(current)
  }
  return path.join(realpathSync(current), ...tail)
}

/** As written and fully resolved: `~/.aws` may be a symlink to another folder. */
function spellings(target: string): string[] {
  return [...new Set([path.resolve(target), resolveThroughExisting(target)])]
}

export function postcheckSecretPaths(args: {
  homeDir: string
  userDataDir: string
  /** Other Dobius userData roots (their full runtime keys); glob entries are skipped. */
  otherUserDataDirs?: readonly string[]
}): string[] {
  const homes = spellings(args.homeDir)
  const written = [
    ...homes.flatMap((home) => HOME_SECRET_PATHS.map((entry) => path.join(home, entry))),
    args.userDataDir,
    // Why: sandbox-exec profiles take literal paths, so a `*` root cannot be used.
    ...(args.otherUserDataDirs ?? []).filter((dir) => !/[*?[]/.test(dir))
  ]
  return [...new Set(written.flatMap(spellings))]
}

/**
 * Where the `.env*` symlinks in the run folder point. The sandbox matches a
 * file by its real path, so a `.env` that links to `settings.txt` would
 * otherwise be readable under that name. Throws when the folder is too large
 * to scan fully: the caller must then not run the check.
 */
export function findEnvLinkTargets(cwd: string): string[] {
  const targets = new Set<string>()
  let seen = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      seen += 1
      if (seen > ENV_SCAN_MAX_ENTRIES) {
        throw new Error('the run folder is too large to scan for .env links')
      }
      const full = path.join(dir, entry.name)
      if (entry.name.startsWith('.env') && entry.isSymbolicLink()) {
        targets.add(resolveThroughExisting(full))
      } else if (entry.isDirectory() && !ENV_SCAN_SKIPPED_DIRS.has(entry.name)) {
        walk(full)
      }
    }
  }
  walk(cwd)
  return [...targets]
}
