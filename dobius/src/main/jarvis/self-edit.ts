import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

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

/** Path segments never writable even inside an allowed root. */
const FORBIDDEN_SEGMENTS = new Set(['.git', 'node_modules', 'out', 'dist', '.env'])

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
    const segments = absolute.split(sep)
    if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
      return { ok: false, error: `"${requested}" is in a protected directory.` }
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
    if (realRoots.some((root) => containedBy(realAbsolute, root))) {
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
    private readonly now: () => number = Date.now
  ) {}

  propose(requestedPath: string, newContent: string, description: string): ProposeResult {
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
