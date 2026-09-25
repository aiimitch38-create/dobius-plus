import { randomBytes } from 'node:crypto'
import {
  constants as fsConstants,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'

export type SafeJsonStatus = 'ok' | 'missing' | 'unreadable'

export type SafeJsonLoadResult<T> = {
  status: SafeJsonStatus
  value: T
  // errno code or parse problem; never file contents.
  detail: string | null
}

export type SafeJsonFileOptions<T> = {
  // Resolved lazily so each store keeps its current userData location exactly.
  filePath: () => string
  // Returns undefined when the parsed JSON has the wrong top-level shape.
  parse: (raw: unknown) => T | undefined
  // First-run value used when the file does not exist yet.
  fallback: () => T
  // Log prefix, e.g. '[agents] agents.json'.
  label: string
  // File mode for newly written files (e.g. 0o600 for account metadata).
  mode?: number
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}

function errorText(error: unknown): string {
  return errorCode(error) ?? (error instanceof Error ? error.message : String(error))
}

// Reads never write: a failed read must not be able to replace real data.
export function readSafeJsonFile<T>(
  filePath: string,
  parse: (raw: unknown) => T | undefined,
  fallback: () => T
): SafeJsonLoadResult<T> {
  let text: string
  try {
    text = readFileSync(filePath, 'utf-8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { status: 'missing', value: fallback(), detail: null }
    }
    return { status: 'unreadable', value: fallback(), detail: errorText(error) }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { status: 'unreadable', value: fallback(), detail: 'invalid JSON' }
  }
  const value = parse(raw)
  if (value === undefined) {
    return { status: 'unreadable', value: fallback(), detail: 'unexpected JSON shape' }
  }
  return { status: 'ok', value, detail: null }
}

/**
 * Parses every entry of a stored list, or returns undefined (-> unreadable)
 * when any entry is malformed. Why: dropping the bad entry and loading as ok
 * lets the next save write the filtered list over the original file.
 */
export function parseEveryEntry<T>(
  entries: unknown[],
  parseEntry: (entry: unknown) => T | null
): T[] | undefined {
  const parsed: T[] = []
  for (const entry of entries) {
    const value = parseEntry(entry)
    if (value === null) {
      return undefined
    }
    parsed.push(value)
  }
  return parsed
}

/**
 * Same contract as parseEveryEntry for a JSON object keyed by id: undefined
 * (-> unreadable) when the value is not a plain object or any entry is malformed.
 */
export function parseEveryValue<T>(
  raw: unknown,
  parseEntry: (entry: unknown, key: string) => T | null
): Record<string, T> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined
  }
  const parsed: Record<string, T> = {}
  for (const [key, entry] of Object.entries(raw)) {
    const value = parseEntry(entry, key)
    if (value === null) {
      return undefined
    }
    parsed[key] = value
  }
  return parsed
}

export function uniqueTmpPath(target: string): string {
  // Why: pid alone collides when two writers in one process save the same file.
  return `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
}

// Throws on failure; the original file is untouched unless rename succeeded.
// The unique temp file is removed on every failure, including a partial write.
export function writeFileAtomic(target: string, data: string, mode?: number): void {
  const tmp = uniqueTmpPath(target)
  mkdirSync(path.dirname(target), { recursive: true })
  try {
    writeFileSync(tmp, data, mode === undefined ? 'utf-8' : { encoding: 'utf-8', mode })
    renameSync(tmp, target)
  } catch (error) {
    removeTempFile(tmp)
    throw error
  }
}

export function writeJsonFileAtomic(target: string, value: unknown, mode?: number): void {
  writeFileAtomic(target, `${JSON.stringify(value, null, 2)}\n`, mode)
}

// Never throws: the temp may never have been created (ENOENT is expected).
export function removeTempFile(tmp: string): void {
  try {
    unlinkSync(tmp)
  } catch (cleanupError) {
    if (errorCode(cleanupError) !== 'ENOENT') {
      console.warn(`[storage] could not remove temp file ${tmp}: ${errorText(cleanupError)}`)
    }
  }
}

// Why 10 minutes: every writer here is synchronous and finishes in well under
// a second, so a temp this old can only be the residue of a crashed or failed write.
export const STALE_TEMP_MIN_AGE_MS = 10 * 60_000

function isOtherLiveProcess(pid: number): boolean {
  if (pid === process.pid) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return errorCode(error) === 'EPERM'
  }
}

/**
 * Removes abandoned temp files in `dir` whose name matches `pattern`.
 * Capture group 1, when present, is the writer's pid. A temp is kept when it
 * is younger than `minAgeMs` or its writer is another live process, so a
 * concurrent writer's in-flight temp is never deleted. Never throws.
 */
export function sweepStaleTempFiles(
  dir: string,
  pattern: RegExp,
  minAgeMs: number = STALE_TEMP_MIN_AGE_MS,
  now: number = Date.now()
): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      console.warn(`[storage] could not scan ${dir} for stale temp files: ${errorText(error)}`)
    }
    return []
  }
  const removed: string[] = []
  for (const name of names) {
    const match = pattern.exec(name)
    if (!match) {
      continue
    }
    if (match[1] !== undefined && isOtherLiveProcess(Number(match[1]))) {
      continue
    }
    const tmp = path.join(dir, name)
    try {
      if (now - statSync(tmp).mtimeMs < minAgeMs) {
        continue
      }
      unlinkSync(tmp)
      removed.push(name)
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        console.warn(`[storage] could not remove stale temp file ${tmp}: ${errorText(error)}`)
      }
    }
  }
  return removed
}

/**
 * One JSON file owned by one store. While the file is unreadable the store
 * keeps session-only values in memory, refuses to save over the original,
 * and re-reads on every access so a repaired file recovers without restart.
 */
export class SafeJsonFile<T> {
  private cached: T | null = null
  // Meaningful only once `cached` is set.
  private status: SafeJsonStatus = 'missing'
  private detail: string | null = null
  private lastLoggedDetail: string | null = null
  private lastRefusedDetail: string | null = null
  private quarantinedFingerprint: string | null = null

  constructor(private readonly options: SafeJsonFileOptions<T>) {}

  get(): T {
    if (this.cached !== null && this.status !== 'unreadable') {
      return this.cached
    }
    const result = readSafeJsonFile(
      this.options.filePath(),
      this.options.parse,
      this.options.fallback
    )
    if (result.status === 'unreadable') {
      this.markUnreadable(result.detail ?? 'unreadable')
      // Keep session-only edits made while unreadable instead of resetting them each access.
      if (this.cached === null) {
        this.cached = result.value
      }
      return this.cached
    }
    if (this.status === 'unreadable' && this.cached !== null) {
      console.warn(`${this.options.label} is readable again; unsaved session changes were dropped`)
    }
    this.status = result.status
    this.detail = null
    this.lastLoggedDetail = null
    this.lastRefusedDetail = null
    this.cached = result.value
    return this.cached
  }

  // Status of the most recent read; call get() first.
  getStatus(): { status: SafeJsonStatus; detail: string | null } {
    return { status: this.status, detail: this.detail }
  }

  /**
   * Returns false (and never throws) when the value could not be saved.
   * Why no throw: callers include run finalization and background pollers
   * whose bookkeeping must not abort; every store already treated a failed
   * write as warn-and-continue.
   */
  set(value: T): boolean {
    const wasUnreadable = this.status === 'unreadable'
    this.get()
    if (wasUnreadable && this.status !== 'unreadable') {
      // Why: `value` was derived from the session-only copy; writing it would
      // clobber the file that just became readable again.
      console.error(
        `${this.options.label} not saved: the file changed on disk; reloaded it instead`
      )
      return false
    }
    this.cached = value
    if (this.status === 'unreadable') {
      if (this.lastRefusedDetail !== this.detail) {
        this.lastRefusedDetail = this.detail
        console.error(
          `${this.options.label} not saved: the existing file is unreadable (${this.detail}); fix or remove it`
        )
      }
      return false
    }
    try {
      writeJsonFileAtomic(this.options.filePath(), value, this.options.mode)
      this.status = 'ok'
      return true
    } catch (error) {
      console.warn(`${this.options.label} failed to persist: ${errorText(error)}`)
      return false
    }
  }

  private markUnreadable(detail: string): void {
    this.status = 'unreadable'
    this.detail = detail
    if (this.lastLoggedDetail !== detail) {
      this.lastLoggedDetail = detail
      console.error(
        `${this.options.label} unreadable (${this.options.filePath()}: ${detail}); saves are blocked until it is fixed`
      )
    }
    this.quarantine()
  }

  private quarantine(): void {
    this.quarantinedFingerprint = keepUnreadableCopy(
      this.options.filePath(),
      this.options.label,
      this.quarantinedFingerprint
    )
  }

  // Next get() re-reads the file. Quarantine bookkeeping is kept, so the
  // same bad file is not copied again.
  invalidate(): void {
    this.cached = null
  }
}

/**
 * Copies an unreadable file to `<file>.unreadable-<ms>` unless the same bytes
 * (size/mtime/inode) were already copied. Returns the fingerprint to pass back
 * next time. Never throws.
 * Why: keep a copy of the bad bytes as evidence; quarantine copies are never deleted.
 */
export function keepUnreadableCopy(
  target: string,
  label: string,
  lastFingerprint: string | null
): string {
  let fingerprint: string
  try {
    const stat = statSync(target)
    fingerprint = `${stat.size}:${stat.mtimeMs}:${stat.ino}`
  } catch (error) {
    fingerprint = `stat-failed:${errorText(error)}`
  }
  if (lastFingerprint === fingerprint) {
    return fingerprint
  }
  const copyPath = `${target}.unreadable-${Date.now()}`
  try {
    copyFileSync(target, copyPath, fsConstants.COPYFILE_EXCL)
    console.error(`${label} unreadable copy kept at ${copyPath}`)
  } catch (error) {
    console.error(`${label} could not keep an unreadable copy: ${errorText(error)}`)
  }
  return fingerprint
}
