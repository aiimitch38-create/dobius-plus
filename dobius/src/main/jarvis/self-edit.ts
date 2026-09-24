import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

export type SelfEditProposal = {
  id: string
  absolutePath: string
  displayPath: string
  description: string
  oldContent: string
  newContent: string
  createdAt: number
  /** Set once written; keeps the backup path for a one-step undo. */
  appliedBackupPath?: string
}

export type ProposeResult =
  | { ok: true; proposal: SelfEditProposal }
  | { ok: false; error: string }

export type ApplyResult = { ok: true; displayPath: string } | { ok: false; error: string }

const MAX_CONTENT_BYTES = 512 * 1024

/**
 * Directories Adam may rewrite: the app that runs him and the service that
 * thinks for him. Everything else on the machine is out of reach regardless of
 * what the model asks for.
 */
export function selfEditRoots(home: string, repoRoot: string): string[] {
  return [repoRoot, join(home, 'dobius', 'projects', 'ADAM')]
}

export type SelfEditRepoRoot = { ok: true; root: string } | { ok: false; error: string }

/**
 * The Dobius+ checkout Adam may rewrite, from explicit configuration only.
 *
 * Why not app.getAppPath(): two parents of it is the bundle's `Contents` folder
 * when packaged and the folder ABOVE the checkout in dev, so neither is the repo.
 * DOBIUS_SELF_EDIT_REPO_ROOT names the checkout on purpose; in dev the launcher
 * (run-electron-vite-dev.mjs) already sets DOBIUS_DEV_REPO_ROOT to this checkout.
 * With neither, self-edit refuses rather than guessing a folder.
 */
export function resolveSelfEditRepoRoot(options: {
  isPackaged: boolean
  env: NodeJS.ProcessEnv
  home: string
  isDirectory?: (p: string) => boolean
}): SelfEditRepoRoot {
  const { isPackaged, env, home } = options
  const isDirectory = options.isDirectory ?? defaultIsDirectory
  const explicit = env.DOBIUS_SELF_EDIT_REPO_ROOT?.trim()
  const configured = explicit || (isPackaged ? '' : env.DOBIUS_DEV_REPO_ROOT?.trim())
  if (!configured) {
    return {
      ok: false,
      error:
        'Self-edit is off: no Dobius+ source folder is configured. Set DOBIUS_SELF_EDIT_REPO_ROOT to the Dobius+ checkout and restart.'
    }
  }
  if (!isAbsolute(configured)) {
    return {
      ok: false,
      error: `Self-edit is off: the configured source folder "${configured}" is not an absolute path.`
    }
  }
  const root = resolve(configured)
  // Why: a filesystem or home root would make nearly every file on the machine editable.
  if (root === parse(root).root || root === resolve(home)) {
    return {
      ok: false,
      error: `Self-edit is off: "${root}" is too broad to be the Dobius+ source folder.`
    }
  }
  if (!isDirectory(root)) {
    return {
      ok: false,
      error: `Self-edit is off: the configured source folder "${root}" does not exist.`
    }
  }
  return { ok: true, root }
}

function defaultIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Path segments never writable even inside an allowed root. Compared
 * case-insensitively: the default macOS volume treats `.GIT` as `.git`.
 */
const FORBIDDEN_SEGMENTS = new Set(['.git', 'node_modules', 'out', 'dist', '.ssh', '.gnupg'])

/**
 * Sensitive-file policy: credential and secret files are never writable, in any
 * folder. Covers every `.env` variant (`.env.local`, `.env.production`, ...),
 * package-manager and git credential files, private keys and certificates, and
 * the ADAM service token.
 */
const SENSITIVE_FILE_NAMES = new Set([
  '.envrc',
  '.npmrc',
  '.netrc',
  '.pypirc',
  '.git-credentials',
  'auth.json',
  'credentials',
  'credentials.json',
  'service-token',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519'
])
const SENSITIVE_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx', '.enc', '.keystore', '.jks']

export function isSensitiveFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower === '.env' ||
    lower.startsWith('.env.') ||
    SENSITIVE_FILE_NAMES.has(lower) ||
    SENSITIVE_EXTENSIONS.some((extension) => lower.endsWith(extension))
  )
}

function protectedReason(segments: string[], requested: string): string | null {
  const parts = segments.filter(Boolean)
  if (parts.some((segment) => FORBIDDEN_SEGMENTS.has(segment.toLowerCase()))) {
    return `"${requested}" is in a protected directory.`
  }
  const leaf = parts.at(-1)
  if (leaf && isSensitiveFileName(leaf)) {
    return `"${requested}" is a secrets or credentials file.`
  }
  return null
}

function containedBy(child: string, parent: string): boolean {
  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`
  return child === parent || child.startsWith(normalizedParent)
}

/**
 * Resolves a requested path to a real absolute path inside an allowed root.
 *
 * Why realpath on the parent: a symlink inside an allowed root could otherwise
 * point anywhere, and a containment check on the unresolved string would pass
 * while the write landed outside.
 */
export function resolveEditablePath(
  requested: string,
  roots: string[],
  realpath: (p: string) => string = realpathSync,
  exists: (p: string) => boolean = existsSync
): { ok: true; absolutePath: string } | { ok: false; error: string } {
  if (!requested.trim()) {
    return { ok: false, error: 'No file path given.' }
  }
  // Why realpath the roots too: on macOS /tmp is a symlink to /private/tmp, so
  // a resolved file path can be "outside" a root that is really the same place.
  const realRoots = roots.map((root) => {
    try {
      return realpath(root)
    } catch {
      return resolve(root)
    }
  })
  const candidates = isAbsolute(requested)
    ? [requested]
    : roots.map((root) => resolve(root, requested))

  for (const candidate of candidates) {
    const absolute = resolve(candidate)
    const lexicalReason = protectedReason(absolute.split(sep), requested)
    if (lexicalReason) {
      return { ok: false, error: lexicalReason }
    }
    let resolvedParent: string
    try {
      resolvedParent = realpath(dirname(absolute))
    } catch {
      return { ok: false, error: `The folder for "${requested}" does not exist.` }
    }
    // Why realpath the TARGET too, not just its parent: an existing file can
    // itself be a symlink pointing outside the roots. Checking only the parent
    // passes, and the later write follows the link and lands anywhere on disk.
    let realAbsolute = join(resolvedParent, absolute.split(sep).pop() ?? '')
    if (exists(realAbsolute)) {
      try {
        realAbsolute = realpath(realAbsolute)
      } catch {
        return { ok: false, error: `"${requested}" could not be resolved.` }
      }
    }
    const containingRoot = realRoots.find((root) => containedBy(realAbsolute, root))
    if (containingRoot) {
      // Why check again after realpath: an in-root symlink (`link -> .git`,
      // `config.ts -> .env.local`) passes the check on the requested string
      // while the write lands in a protected place.
      const canonicalReason = protectedReason(
        relative(containingRoot, realAbsolute).split(sep),
        requested
      )
      if (canonicalReason) {
        return { ok: false, error: canonicalReason }
      }
      return { ok: true, absolutePath: realAbsolute }
    }
  }
  return {
    ok: false,
    error: `"${requested}" is outside the folders Adam may edit (the Dobius+ repo and the ADAM service).`
  }
}

/**
 * Writes without following a symlink at the target.
 *
 * Why: resolveEditablePath checks the path, but a symlink could be swapped in
 * between that check and this write. O_NOFOLLOW makes the kernel refuse rather
 * than letting the write escape the allowed roots.
 */
function writeFileSyncNoFollow(path: string, content: string): void {
  const { O_WRONLY, O_TRUNC, O_CREAT, O_NOFOLLOW } = constants
  // O_NOFOLLOW is POSIX-only; on Windows the flag is absent and 0 is a no-op.
  const flags = O_WRONLY | O_TRUNC | O_CREAT | (O_NOFOLLOW ?? 0)
  const fd = openSync(path, flags, 0o644)
  try {
    writeFileSync(fd, content, 'utf-8')
  } finally {
    closeSync(fd)
  }
}

/** In-memory store: proposals are deliberately not durable across a restart. */
export class SelfEditStore {
  private readonly proposals = new Map<string, SelfEditProposal>()
  private sequence = 0

  constructor(
    private readonly roots: string[],
    private readonly now: () => number = Date.now,
    /** Set when no repo root is configured: every proposal is refused with it. */
    private readonly unavailableReason: string | null = null
  ) {}

  propose(requestedPath: string, newContent: string, description: string): ProposeResult {
    if (this.unavailableReason) {
      return { ok: false, error: this.unavailableReason }
    }
    if (typeof newContent !== 'string') {
      return { ok: false, error: 'No file content given.' }
    }
    if (Buffer.byteLength(newContent, 'utf-8') > MAX_CONTENT_BYTES) {
      return { ok: false, error: 'That change is too large to review by voice.' }
    }
    const resolved = resolveEditablePath(requestedPath, this.roots)
    if (!resolved.ok) {
      return resolved
    }
    const oldContent = existsSync(resolved.absolutePath)
      ? readFileSync(resolved.absolutePath, 'utf-8')
      : ''
    if (oldContent === newContent) {
      return { ok: false, error: 'That change is identical to the current file.' }
    }
    this.sequence += 1
    const proposal: SelfEditProposal = {
      id: `edit_${this.sequence}`,
      absolutePath: resolved.absolutePath,
      displayPath: this.toDisplayPath(resolved.absolutePath),
      description: description.trim() || 'No description given.',
      oldContent,
      newContent,
      createdAt: this.now()
    }
    this.proposals.set(proposal.id, proposal)
    return { ok: true, proposal }
  }

  get(id: string): SelfEditProposal | null {
    return this.proposals.get(id) ?? null
  }

  list(): SelfEditProposal[] {
    return [...this.proposals.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * Writes the change, keeping a timestamped backup first so any approved edit
   * can be undone in one step — voice approval is easy to give by accident.
   */
  apply(id: string, backupDir: string): ApplyResult {
    const proposal = this.proposals.get(id)
    if (!proposal) {
      return { ok: false, error: 'That change is no longer pending.' }
    }
    // Why re-resolve: review can take minutes, and a parent folder swapped for a
    // symlink meanwhile would redirect the write; O_NOFOLLOW only guards the leaf.
    const recheck = resolveEditablePath(proposal.absolutePath, this.roots)
    if (!recheck.ok || recheck.absolutePath !== proposal.absolutePath) {
      return {
        ok: false,
        error: recheck.ok ? `"${proposal.displayPath}" moved since it was proposed.` : recheck.error
      }
    }
    try {
      mkdirSync(backupDir, { recursive: true })
      if (existsSync(proposal.absolutePath)) {
        const backupPath = join(backupDir, `${proposal.id}-${proposal.createdAt}.bak`)
        copyFileSync(proposal.absolutePath, backupPath)
        proposal.appliedBackupPath = backupPath
      }
      writeFileSyncNoFollow(proposal.absolutePath, proposal.newContent)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    this.proposals.delete(id)
    return { ok: true, displayPath: proposal.displayPath }
  }

  discard(id: string): boolean {
    return this.proposals.delete(id)
  }

  private toDisplayPath(absolutePath: string): string {
    for (const root of this.roots.map((entry) => {
      try {
        return realpathSync(entry)
      } catch {
        return entry
      }
    })) {
      if (containedBy(absolutePath, root)) {
        return absolutePath.slice(root.length + 1) || absolutePath
      }
    }
    return absolutePath
  }
}
