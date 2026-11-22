import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { AdamThreadRow } from '../../shared/speech-types'

export const ADAM_THREAD_CHANNEL = 'jarvis:adam-thread'
export const ADAM_THREAD_CAP = 200
const MAX_ROW_CHARS = 32_000

/** A row as a window sent it: plain JSON with an id, a role and text, or nothing. */
export function adamThreadRowOf(value: unknown): AdamThreadRow | null {
  let row: Record<string, unknown>
  try {
    const json = JSON.stringify(value)
    if (typeof json !== 'string' || json.length > MAX_ROW_CHARS) {
      return null
    }
    row = JSON.parse(json)
  } catch {
    return null
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return null
  }
  const idOk = typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 128
  const roleOk = row.role === 'user' || row.role === 'assistant' || row.role === 'system'
  return idOk && roleOk && typeof row.text === 'string' ? (row as AdamThreadRow) : null
}

/**
 * ADAM's one thread. Main is its only owner: windows ask it to add a row and
 * are sent the whole thread back, so two windows can never overwrite each
 * other's rows. Kept to the latest ADAM_THREAD_CAP rows in memory and on disk.
 */
export class AdamThreadStore {
  private rows: AdamThreadRow[] | null = null
  private loading: Promise<AdamThreadRow[]> | null = null
  private saving: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly announce: (rows: AdamThreadRow[]) => void
  ) {}

  get(): Promise<AdamThreadRow[]> {
    if (this.rows) {
      return Promise.resolve(this.rows)
    }
    this.loading ??= readFile(this.file, 'utf8')
      .then((raw) => {
        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed)
          ? parsed.flatMap((row) => adamThreadRowOf(row) ?? []).slice(-ADAM_THREAD_CAP)
          : []
      })
      // A missing or unreadable file is an empty thread; the next row rewrites it.
      .catch(() => [])
      .then((rows) => (this.rows ??= rows))
    return this.loading
  }

  /**
   * Adds a row once (a repeated id is ignored) and tells the window. Rejects
   * when the thread could not be written to disk; the row stays in memory and
   * is written again with the next change.
   */
  async append(row: AdamThreadRow): Promise<void> {
    await this.get()
    // Why read here, with no await before the set: appends that arrive together
    // must each see the other's row.
    const rows = this.rows ?? []
    if (rows.some((existing) => existing.id === row.id)) {
      return
    }
    await this.set([...rows, row].slice(-ADAM_THREAD_CAP))
  }

  async clear(): Promise<void> {
    await this.get()
    await this.set([])
  }

  private set(rows: AdamThreadRow[]): Promise<void> {
    this.rows = rows
    this.announce(rows)
    // One write at a time, each writing the newest rows, so a slow write cannot land
    // last with old ones. A failed write is the caller's to report; it does not stop later ones.
    const saved = this.saving.then(() => this.save())
    this.saving = saved.catch(() => undefined)
    return saved
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(this.rows ?? []), { mode: 0o600, flag: 'wx' })
      await rename(temp, this.file)
    } finally {
      await rm(temp, { force: true })
    }
  }
}
