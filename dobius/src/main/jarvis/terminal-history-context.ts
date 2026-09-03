import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TAIL_BYTES = 8_000
const TAIL_LINES = 12
// Built rather than written as a literal: a regex literal containing control
// bytes trips no-control-regex, and suppressing that rule hides real mistakes.
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const ANSI = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)|[\\x00-\\x08\\x0b-\\x1f\\x7f]`,
  'g'
)

export type TerminalActivity = {
  worktreePath: string
  lastActiveAt: number
  recentOutput: string
}

/**
 * Decodes a history directory name back to the worktree path it belongs to.
 * Layout is `<worktreeId>::<urlencoded worktree path>@@<pty hash>`.
 */
export function decodeHistoryDirName(name: string): string | null {
  let decoded = name
  try {
    decoded = decodeURIComponent(name)
  } catch {
    // A malformed escape is still worth reading as a literal name.
  }
  const withoutHash = decoded.split('@@')[0] ?? ''
  const separator = withoutHash.indexOf('::')
  if (separator === -1) {
    return null
  }
  const path = withoutHash.slice(separator + 2)
  return path.length > 0 ? path : null
}

/** Reads the tail of a file without loading the whole thing into memory. */
function readTail(path: string, bytes: number): string {
  let fd: number | null = null
  try {
    const size = statSync(path).size
    const length = Math.min(bytes, size)
    const buffer = Buffer.alloc(length)
    fd = openSync(path, 'r')
    readSync(fd, buffer, 0, length, Math.max(0, size - length))
    return buffer.toString('utf-8')
  } catch {
    return ''
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

export function cleanTerminalOutput(raw: string): string {
  return raw
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(-TAIL_LINES)
    .join('\n')
}

/**
 * The terminals the user actually touched, newest first.
 *
 * Why the history files and not the runtime: the runtime only stamps
 * lastOutputAt while something is actively tailing a pty, so `terminal list`
 * reports null for every terminal and its tail buffer reads back empty. These
 * logs are written continuously, so their mtime is an honest answer to "which
 * terminal was I last working in" and their tail is "what was I doing".
 */
export function readRecentTerminalActivity(historyRoot: string, limit = 3): TerminalActivity[] {
  let entries: string[]
  try {
    entries = readdirSync(historyRoot)
  } catch {
    return []
  }

  const candidates: { worktreePath: string; lastActiveAt: number; logPath: string }[] = []
  for (const name of entries) {
    const worktreePath = decodeHistoryDirName(name)
    if (!worktreePath) {
      continue
    }
    const logPath = join(historyRoot, name, 'output.log')
    try {
      candidates.push({ worktreePath, lastActiveAt: statSync(logPath).mtimeMs, logPath })
    } catch {
      // No output.log means the terminal never produced anything worth reading.
    }
  }

  candidates.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  return candidates.slice(0, limit).map((candidate) => ({
    worktreePath: candidate.worktreePath,
    lastActiveAt: candidate.lastActiveAt,
    recentOutput: cleanTerminalOutput(readTail(candidate.logPath, TAIL_BYTES))
  }))
}
