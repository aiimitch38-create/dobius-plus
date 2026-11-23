import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { isSecretOrSkippedPath } from '../library-secrets'

/**
 * Each JSON line of a file that passes `keep` (a cheap text test run before
 * parsing; tool output lines are most of a transcript and are never parsed).
 */
export async function* jsonLines(
  file: string,
  keep: (line: string) => boolean
): AsyncGenerator<Record<string, unknown>> {
  const lines = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })
  for await (const line of lines) {
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

export type FileStat = { path: string; mtimeMs: number; size: number }

/** .jsonl files under dir, `depth` levels down (1 = directly inside). */
export async function jsonlFiles(dir: string, depth: number): Promise<FileStat[]> {
  const out: FileStat[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory() && depth > 1) {
      out.push(...(await jsonlFiles(full, depth - 1)))
    } else if (entry.isFile() && entry.name.endsWith('.jsonl') && !isSecretOrSkippedPath(full)) {
      try {
        const info = await stat(full)
        out.push({ path: full, mtimeMs: info.mtimeMs, size: info.size })
      } catch {
        continue
      }
    }
  }
  return out
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function timeOf(value: unknown, fallback: number): number {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(ms) ? ms : fallback
}
