import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isSecretOrSkippedPath, isSkippedDirName } from '../library-secrets'
import { realRoot, safeFile } from './safe-path'

/** Lines longer than this are skipped unparsed (tool output; never message text worth keeping). */
export const MAX_LINE_CHARS = 1_000_000

/**
 * Lines of a file, never buffering more than maxChars of one line: a longer
 * line is dropped as it streams past. Why not readline: it holds a whole line
 * in memory, and one transcript line can be hundreds of megabytes.
 */
export async function* boundedLines(file: string, maxChars = MAX_LINE_CHARS): AsyncGenerator<string> {
  let parts: string[] = []
  let length = 0
  let skipping = false
  for await (const chunk of createReadStream(file, { encoding: 'utf8', highWaterMark: 64 * 1024 })) {
    let text = chunk as string
    let newline = text.indexOf('\n')
    while (newline !== -1) {
      const piece = text.slice(0, newline)
      if (!skipping && length + piece.length <= maxChars) {
        parts.push(piece)
        yield parts.join('').replace(/\r$/, '')
      }
      parts = []
      length = 0
      skipping = false
      text = text.slice(newline + 1)
      newline = text.indexOf('\n')
    }
    if (!skipping) {
      length += text.length
      if (length > maxChars) {
        parts = []
        skipping = true
      } else if (text) {
        parts.push(text)
      }
    }
  }
  if (!skipping && parts.length > 0) {
    yield parts.join('')
  }
}

/**
 * Each JSON line of a file that passes `keep` (a cheap text test run before
 * parsing; tool output lines are most of a transcript and are never parsed).
 */
export async function* jsonLines(
  file: string,
  keep: (line: string) => boolean
): AsyncGenerator<Record<string, unknown>> {
  for await (const line of boundedLines(file)) {
    if (!keep(line)) {
      continue
    }
    try {
      const value: unknown = JSON.parse(line)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        yield value as Record<string, unknown>
      }
    } catch {
      // A torn last line of a transcript still being written: skip it.
      continue
    }
  }
}

export type FileStat = { path: string; mtimeMs: number; size: number; root: string }

async function collect(dir: string, depth: number, root: string, out: FileStat[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory() && depth > 1 && !isSkippedDirName(entry.name)) {
      await collect(full, depth - 1, root, out)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl') && !isSecretOrSkippedPath(full)) {
      const info = await lstat(full).catch(() => null)
      if (info?.isFile()) {
        out.push({ path: full, mtimeMs: info.mtimeMs, size: info.size, root })
      }
    }
  }
}

/** .jsonl files under dir's real path, `depth` levels down (1 = directly inside). */
export async function jsonlFiles(dir: string, depth: number): Promise<FileStat[]> {
  const root = await realRoot(dir)
  const out: FileStat[] = []
  if (root) {
    await collect(root, depth, root, out)
  }
  return out
}

/** Transcript lines, after the read-time symlink and secret check. */
export async function* safeJsonLines(
  file: FileStat,
  keep: (line: string) => boolean
): AsyncGenerator<Record<string, unknown>> {
  const real = await safeFile(file.path, file.root)
  if (real) {
    yield* jsonLines(real, keep)
  }
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function timeOf(value: unknown, fallback: number): number {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(ms) ? ms : fallback
}
