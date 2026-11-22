// Why: `dobius file read|write|search` is reachable by any agent in a Dobius
// terminal (they hold the full runtime key). These checks keep an agent inside
// the Dobius-managed worktree it named and away from secrets, on top of what
// the shared file methods already do. Writes additionally go through the
// mobile write guard (symlinks, dot-files, agent-instruction files, Dobius data).
import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { assertMobileWriteAllowed, foldApfsName } from './mobile-write-path-guard'

export class AgentFileRefusedError extends Error {
  constructor(reason: string) {
    super(`file access refused: ${reason}`)
    this.name = 'AgentFileRefusedError'
  }
}

// Matched against each folded file name (and the resolved name after symlinks).
const SECRET_FILE_NAME_PATTERNS: readonly RegExp[] = [
  /^\.env/,
  /key/,
  /secret/,
  /credential/,
  /token/,
  /password/,
  /^dobius-runtime.*\.json$/,
  /\.(pem|p12|pfx|keystore)$/,
  /^id_(rsa|dsa|ecdsa|ed25519)/,
  /^\.netrc$/,
  /^\.npmrc$/,
  /^\.pgpass$/
]
const SECRET_DIRECTORY_NAMES = new Set(['.ssh', '.aws', '.gnupg', '.docker', '.kube'])

/** The same rules as globs, so a search never even opens a secret file (a
 *  post-filter alone would leak through match counts and truncation). Passed
 *  as caseInsensitiveExcludeGlobs: rg --iglob, git grep :(exclude,icase,glob). */
export const SECRET_SEARCH_EXCLUDE_GLOBS: readonly string[] = [
  '**/.env*',
  '**/*key*',
  '**/*secret*',
  '**/*credential*',
  '**/*token*',
  '**/*password*',
  '**/dobius-runtime*.json',
  '**/*.pem',
  '**/*.p12',
  '**/*.pfx',
  '**/*.keystore',
  '**/id_rsa*',
  '**/id_dsa*',
  '**/id_ecdsa*',
  '**/id_ed25519*',
  '**/.netrc',
  '**/.npmrc',
  '**/.pgpass',
  ...[...SECRET_DIRECTORY_NAMES].map((name) => `**/${name}/**`)
]

function segmentsOf(relativePath: string): string[] {
  return relativePath.replaceAll('\\', '/').split('/')
}

export function isSecretLookingPath(relativePath: string): boolean {
  const segments = segmentsOf(relativePath).map((segment) => foldApfsName(segment.trim()))
  const name = segments.at(-1) ?? ''
  if (SECRET_FILE_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return true
  }
  return segments.some((segment) => SECRET_DIRECTORY_NAMES.has(segment))
}

/** Lexical check: relative, no `..`/`.`/empty segment, not a drive path, not secret. */
export function assertAgentRelativePath(relativePath: string): void {
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('/') ||
    relativePath.startsWith('\\') ||
    /^[a-zA-Z]:/.test(relativePath) ||
    relativePath.includes('\0')
  ) {
    throw new AgentFileRefusedError('path must be relative to the worktree')
  }
  if (segmentsOf(relativePath).some((part) => part === '' || part === '.' || part === '..')) {
    throw new AgentFileRefusedError('path must stay inside the worktree (no "..")')
  }
  if (isSecretLookingPath(relativePath)) {
    throw new AgentFileRefusedError('secret-looking file (env, key, token, credential)')
  }
}

// Why no case folding: both sides are realpaths (on-disk spelling), and folding
// would treat /repo/wt and /repo/WT as one folder on a case-sensitive volume.
function isInsideReal(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export type AgentFileTarget = {
  worktreeRoot: string
  relativePath: string
  // SSH worktrees are refused: the symlink and secret checks need a realpath
  // of the remote filesystem, which this guard does not do yet.
  connectionId?: string
}

// Why: without a remote realpath a symlink in an SSH worktree could lead to a
// secret or out of the worktree unseen, so remote targets are refused outright.
function assertLocalTarget(target: AgentFileTarget): void {
  if (target.connectionId) {
    throw new AgentFileRefusedError(
      "file read/write isn't available for remote worktrees yet"
    )
  }
}

/** Read: the file must exist and, after following symlinks, still be inside
 *  the worktree and still not look like a secret. */
export async function assertAgentReadAllowed(target: AgentFileTarget): Promise<void> {
  assertAgentRelativePath(target.relativePath)
  assertLocalTarget(target)
  const realRoot = await realpath(target.worktreeRoot)
  let realTarget: string
  try {
    realTarget = await realpath(join(target.worktreeRoot, target.relativePath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AgentFileRefusedError('file not found')
    }
    throw error
  }
  if (!isInsideReal(realTarget, realRoot)) {
    throw new AgentFileRefusedError('path resolves outside the worktree')
  }
  if (isSecretLookingPath(relative(realRoot, realTarget))) {
    throw new AgentFileRefusedError('path resolves to a secret-looking file')
  }
}

/** Write: lexical checks, then the mobile write guard with no outside-worktree
 *  allowance (symlinks, `..`, dot-files, agent instructions, Dobius data). */
export async function assertAgentWriteAllowed(
  target: AgentFileTarget,
  dataRoots?: readonly string[]
): Promise<void> {
  assertAgentRelativePath(target.relativePath)
  assertLocalTarget(target)
  try {
    await assertMobileWriteAllowed({
      worktreeRoot: target.worktreeRoot,
      targetPath: join(target.worktreeRoot, target.relativePath),
      allowOutsideWorktree: false,
      ...(dataRoots ? { dataRoots } : {})
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'MobileWriteRefusedError') {
      throw new AgentFileRefusedError(error.message.replace(/^mobile write refused: /, ''))
    }
    throw error
  }
}
