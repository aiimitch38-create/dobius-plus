import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { adamProjectDirectory } from '../adam-connection'
import { protectedReason } from './self-edit-path-policy'
import {
  bytesDigest,
  readSnapshot,
  releaseBackupAfterFailedWrite,
  snapshotDigest
} from './self-edit-snapshot'

export type SelfEditProposal = {
  id: string
  absolutePath: string
  displayPath: string
  description: string
  oldContent: string
  newContent: string
  createdAt: number
  /** sha256 of the file's bytes when proposed; null when it did not exist. */
  originalDigest: string | null
  /** Set once written; keeps the backup path for a one-step undo. */
  appliedBackupPath?: string
}

/** What undo needs once a proposal has been written. */
type AppliedEdit = {
  absolutePath: string
  displayPath: string
  /** Null when the edit created the file: undo removes it again. */
  backupPath: string | null
  originalDigest: string | null
  appliedDigest: string
}

export type ProposeResult =
  | { ok: true; proposal: SelfEditProposal }
  | { ok: false; error: string }

export type ApplyResult =
  | { ok: true; displayPath: string }
  | { ok: false; error: string; conflict?: true }

const MAX_CONTENT_BYTES = 512 * 1024

export const WINDOWS_WRITE_UNSUPPORTED =
  'Adam cannot write his own code on Windows yet: Windows has no safe way to refuse a link swapped in at the last moment. Nothing was written.'

/**
 * Directories Adam may rewrite: the app that runs him and the service that
 * thinks for him. Everything else on the machine is out of reach regardless of
 * what the model asks for.
 */
export function selfEditRoots(home: string, repoRoot: string): string[] {
  return [repoRoot, adamProjectDirectory(home)]
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
        requested,
        { rootRelative: true }
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
function writeFileSyncNoFollow(path: string, content: string | Buffer): void {
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
  private readonly applied = new Map<string, AppliedEdit>()
  private sequence = 0

  constructor(
    private readonly roots: string[],
    private readonly now: () => number = Date.now,
    /** Set when no repo root is configured: every proposal is refused with it. */
    private readonly unavailableReason: string | null = null,
    private readonly platform: NodeJS.Platform = process.platform
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
    // Why keep a digest of the exact bytes: apply must notice any change made
    // to the file while the user was reviewing, not just a different length.
    let original: ReturnType<typeof readSnapshot>
    try {
      original = readSnapshot(resolved.absolutePath)
    } catch (error) {
      // Why catch: a dangling symlink (ELOOP) or unreadable file must reach the
      // voice tool as a spoken refusal, not a rejected IPC promise.
      return {
        ok: false,
        error: `"${requestedPath}" could not be read: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    const oldContent = original.exists ? original.bytes.toString('utf-8') : ''
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
      createdAt: this.now(),
      originalDigest: snapshotDigest(original)
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
    // Why refuse on Windows: every write here relies on O_NOFOLLOW, which
    // Windows lacks, so a symlink or junction swapped in after the path check
    // would be followed and the write would land outside the allowed roots.
    if (this.platform === 'win32') {
      return { ok: false, error: WINDOWS_WRITE_UNSUPPORTED }
    }
    const proposal = this.proposals.get(id)
    if (!proposal) {
      return { ok: false, error: 'That change is no longer pending.' }
    }
    // Why re-resolve: review can take minutes, and a parent folder swapped for a
    // symlink meanwhile would redirect the write; O_NOFOLLOW only guards the leaf.
    const moved = this.recheckPath(proposal.absolutePath, proposal.displayPath, 'proposed')
    if (moved) {
      return moved
    }
    const newBytes = Buffer.from(proposal.newContent, 'utf-8')
    let backupPath: string | null = null
    try {
      const current = readSnapshot(proposal.absolutePath)
      // Why refuse instead of merging: the reviewed diff was computed against
      // the old bytes, so writing now would silently erase the newer edit.
      // The proposal stays pending so the conflict is visible in the window.
      if (snapshotDigest(current) !== proposal.originalDigest) {
        return {
          ok: false,
          conflict: true,
          error: `"${proposal.displayPath}" changed since Adam proposed this edit. Nothing was written; ask Adam to propose it again.`
        }
      }
      mkdirSync(backupDir, { recursive: true })
      if (current.exists) {
        backupPath = join(backupDir, `${proposal.id}-${proposal.createdAt}.bak`)
        // Why the verified bytes and 'wx': the backup must be exactly what was
        // checked above, and must never overwrite an earlier backup.
        writeFileSync(backupPath, current.bytes, { flag: 'wx' })
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    try {
      writeFileSyncNoFollow(proposal.absolutePath, newBytes)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        error: releaseBackupAfterFailedWrite(proposal.absolutePath, proposal.originalDigest, backupPath, reason)
      }
    }
    proposal.appliedBackupPath = backupPath ?? undefined
    this.proposals.delete(id)
    this.applied.set(id, {
      absolutePath: proposal.absolutePath,
      displayPath: proposal.displayPath,
      backupPath,
      originalDigest: proposal.originalDigest,
      appliedDigest: bytesDigest(newBytes)
    })
    return { ok: true, displayPath: proposal.displayPath }
  }

  /**
   * Restores the exact bytes from before an applied edit (or removes a file the
   * edit created). Refuses with a conflict if the file changed after the edit,
   * so undo never erases work done since.
   */
  undo(id: string): ApplyResult {
    if (this.platform === 'win32') {
      return { ok: false, error: WINDOWS_WRITE_UNSUPPORTED }
    }
    const edit = this.applied.get(id)
    if (!edit) {
      return { ok: false, error: 'There is no applied change with that id to undo.' }
    }
    const moved = this.recheckPath(edit.absolutePath, edit.displayPath, 'applied')
    if (moved) {
      return moved
    }
    try {
      if (snapshotDigest(readSnapshot(edit.absolutePath)) !== edit.appliedDigest) {
        return {
          ok: false,
          conflict: true,
          error: `"${edit.displayPath}" changed after the edit was applied. Nothing was undone${edit.backupPath ? `; the original is kept at ${edit.backupPath}` : ''}.`
        }
      }
      if (edit.backupPath) {
        const original = readFileSync(edit.backupPath)
        if (bytesDigest(original) !== edit.originalDigest) {
          return { ok: false, error: `The backup at ${edit.backupPath} was modified. Nothing was undone.` }
        }
        writeFileSyncNoFollow(edit.absolutePath, original)
      } else {
        // Safe: the file holds exactly the bytes this edit created (checked above).
        unlinkSync(edit.absolutePath)
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    this.applied.delete(id)
    return { ok: true, displayPath: edit.displayPath }
  }

  discard(id: string): boolean {
    return this.proposals.delete(id)
  }

  private recheckPath(
    absolutePath: string,
    displayPath: string,
    since: 'proposed' | 'applied'
  ): { ok: false; error: string } | null {
    const recheck = resolveEditablePath(absolutePath, this.roots)
    if (recheck.ok && recheck.absolutePath === absolutePath) {
      return null
    }
    return {
      ok: false,
      error: recheck.ok ? `"${displayPath}" moved since it was ${since}.` : recheck.error
    }
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
