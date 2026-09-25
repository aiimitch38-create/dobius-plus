// Why: a phone with files.write must still never write files that agents or
// the host later obey or execute (agent instructions, hooks, package scripts,
// .git) or Dobius's own data (where dobius-devices.json holds the grants).
// Checks resolve the target the way the filesystem will: symlinks, on-disk
// entry names and APFS case/compatibility folding.
import { lstat, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from 'node:path'
import { getUserDataRoot } from '../storage/user-data-root'

// Why: every dot-file and dot-directory is refused (.git, .claude, .codex,
// .github/instructions, .clinerules, .husky, .vscode, .envrc, .mcp.json, ...):
// that closes the whole class of tool config instead of chasing each agent.
// Top-level-style agent instruction files and host-executed files are named.
const PROTECTED_FILE_NAMES = new Set([
  'claude.md',
  'claude.local.md',
  'agents.md',
  'agents.override.md',
  'gemini.md',
  'crush.md',
  'qwen.md',
  'conventions.md',
  'dobius.yaml',
  // Why: package scripts run on install/test.
  'package.json'
])

export class MobileWriteRefusedError extends Error {
  constructor(reason: string) {
    super(`mobile write refused: ${reason}`)
    this.name = 'MobileWriteRefusedError'
  }
}

// Why: APFS matches names case-insensitively after compatibility folding, so
// "AGENTſ.md" (long s) or a Kelvin-sign "K" open the protected file.
export function foldApfsName(name: string): string {
  return name.normalize('NFKC').replaceAll('\u017F', 's').replaceAll('\u212A', 'k').toLowerCase()
}

function foldedSegments(filePath: string): string[] {
  return filePath
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => foldApfsName(segment.trim()))
    .filter((segment) => segment.length > 0 && segment !== '.')
}

export function isProtectedMobileWritePath(filePath: string): boolean {
  const segments = foldedSegments(filePath)
  const fileName = segments.at(-1) ?? ''
  if (PROTECTED_FILE_NAMES.has(fileName)) {
    return true
  }
  return segments.some((segment) => segment.startsWith('.'))
}

function isInsideFolded(child: string, parent: string): boolean {
  const rel = relative(foldApfsName(parent), foldApfsName(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

async function realpathOrResolve(target: string): Promise<string> {
  try {
    return await realpath(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return resolve(target)
    }
    throw error
  }
}

// Resolve through the deepest existing ancestor; missing tail segments are kept
// as requested (they will be created with those names).
async function resolveOnDisk(requested: string): Promise<{ realTarget: string; exists: boolean }> {
  const tail: string[] = [basename(requested)]
  let dir = dirname(requested)
  for (;;) {
    try {
      const realDir = await realpath(dir)
      const realTarget = join(realDir, ...tail)
      if (tail.length > 1) {
        return { realTarget, exists: false }
      }
      return await resolveExistingEntry(realDir, tail[0]!, realTarget)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(dir) === dir) {
        throw error
      }
      tail.unshift(basename(dir))
      dir = dirname(dir)
    }
  }
}

async function resolveExistingEntry(
  realDir: string,
  requestedName: string,
  realTarget: string
): Promise<{ realTarget: string; exists: boolean }> {
  let stat: Awaited<ReturnType<typeof lstat>>
  try {
    stat = await lstat(realTarget)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { realTarget, exists: false }
    }
    throw error
  }
  if (stat.isSymbolicLink()) {
    throw new MobileWriteRefusedError('target is a symlink')
  }
  const entries = await readdir(realDir)
  if (entries.includes(requestedName)) {
    return { realTarget, exists: true }
  }
  // Why: the name matched a differently spelled on-disk entry (case or
  // Unicode folding). Refuse rather than guess which file will be written.
  for (const entry of entries) {
    const entryStat = await lstat(join(realDir, entry))
    if (entryStat.ino === stat.ino && entryStat.dev === stat.dev) {
      throw new MobileWriteRefusedError(`name resolves to on-disk entry "${entry}"`)
    }
  }
  throw new MobileWriteRefusedError('name does not match an on-disk entry')
}

export function mobileWriteDataRoots(): string[] {
  return [getUserDataRoot(), join(homedir(), '.dobius')]
}

export type MobileWriteCheck = {
  worktreeRoot: string
  targetPath: string
  // SSH worktrees: the host cannot inspect the remote filesystem, so only the
  // folded lexical checks apply.
  connectionId?: string
  // Terminal-artifact writes may target files outside the worktree.
  allowOutsideWorktree: boolean
  dataRoots?: readonly string[]
}

export async function assertMobileWriteAllowed(check: MobileWriteCheck): Promise<void> {
  if (check.connectionId) {
    assertRemoteMobileWrite(check)
    return
  }
  const requested = resolve(check.targetPath)
  const root = resolve(check.worktreeRoot)
  const dataRoots = check.dataRoots ?? mobileWriteDataRoots()
  const { realTarget } = await resolveOnDisk(requested)

  for (const dataRoot of dataRoots) {
    const realDataRoot = await realpathOrResolve(dataRoot)
    if (isInsideFolded(realTarget, realDataRoot) || isInsideFolded(requested, dataRoot)) {
      throw new MobileWriteRefusedError('target is inside Dobius data')
    }
  }

  const realRoot = await realpathOrResolve(root)
  const lexicalInside = isInsideFolded(requested, root)
  const realInside = isInsideFolded(realTarget, realRoot)
  if (lexicalInside || realInside) {
    const lexicalRel = relative(root, requested)
    const realRel = relative(realRoot, realTarget)
    // Why: a symlinked ancestor inside the worktree redirects the write.
    if (!lexicalInside || !realInside || foldApfsName(lexicalRel) !== foldApfsName(realRel)) {
      throw new MobileWriteRefusedError('target resolves somewhere else')
    }
    // Why: checked relative to the worktree, because real worktrees live under
    // <repo>/.claude/worktrees/ and an absolute-path check would refuse them.
    if (isProtectedMobileWritePath(realRel)) {
      throw new MobileWriteRefusedError('agent-instruction, hook, script or .git file')
    }
    return
  }
  if (!check.allowOutsideWorktree) {
    throw new MobileWriteRefusedError('target is outside the worktree')
  }
  if (isProtectedMobileWritePath(realTarget) || isProtectedMobileWritePath(requested)) {
    throw new MobileWriteRefusedError('agent-instruction, hook, script or .git file')
  }
}

function assertRemoteMobileWrite(check: MobileWriteCheck): void {
  const rel = posix.relative(
    posix.resolve(check.worktreeRoot),
    posix.resolve(check.worktreeRoot, check.targetPath)
  )
  const inside = rel === '' || (!rel.startsWith('..') && !posix.isAbsolute(rel))
  if (!inside && !check.allowOutsideWorktree) {
    throw new MobileWriteRefusedError('target is outside the worktree')
  }
  if (isProtectedMobileWritePath(inside ? rel : check.targetPath)) {
    throw new MobileWriteRefusedError('agent-instruction, hook, script or .git file')
  }
}
