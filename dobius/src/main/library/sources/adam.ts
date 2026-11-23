// ADAM: his Dobius thread (userData/adam-thread.json) and his Hermes sessions.
// Hermes keeps transcripts in ~/.hermes/profiles/adam/state.db (`messages`),
// read here read-only. Its sessions/ folder holds only failed-request dumps
// with Authorization headers, so it is never read; nor is ~/.hermes/.env.
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DOCUMENT_MAX_CHARS, RecentSections, titleFrom } from '../library-chunk'
import { isSecretOrSkippedPath } from '../library-secrets'
import type { LibraryCandidate, LibraryDocument, LibraryIngester } from '../library-types'
import SyncDatabase from '../../sqlite/sync-database'
import { safeFile } from './safe-path'

const THREAD_MAX_BYTES = 16 * 1024 * 1024

export type AdamPaths = { threadFile: string; hermesStateDb: string }

/** A file the library may read directly: a regular file, not a link, not a secret. */
async function directFile(file: string): Promise<{ real: string; mtimeMs: number; size: number } | null> {
  const real = await safeFile(file, dirname(await realpath(file).catch(() => file)))
  if (!real) {
    return null
  }
  const info = await stat(real)
  return { real, mtimeMs: info.mtimeMs, size: info.size }
}

async function threadCandidate(file: string): Promise<LibraryCandidate[]> {
  const info = await directFile(file)
  if (!info || info.size > THREAD_MAX_BYTES) {
    return []
  }
  return [
    {
      key: `adam:thread:${file}`,
      source: 'adam',
      path: file,
      mtimeMs: info.mtimeMs,
      size: info.size,
      load: async (): Promise<LibraryDocument | null> => {
        const real = await safeFile(info.real, dirname(info.real))
        const rows: unknown = real ? JSON.parse(await readFile(real, 'utf8')) : null
        if (!Array.isArray(rows)) {
          return null
        }
        // Why the file time: thread rows carry no timestamps of their own.
        const recent = new RecentSections()
        for (const row of rows) {
          const { role, text } = (row ?? {}) as { role?: unknown; text?: unknown }
          if ((role === 'user' || role === 'assistant') && typeof text === 'string' && text.trim()) {
            recent.push({ text: `${role === 'user' ? 'Carson' : 'ADAM'}: ${text.trim()}`, at: info.mtimeMs })
          }
        }
        return { project: 'ADAM', title: 'ADAM thread in Dobius+', sections: recent.sections }
      }
    }
  ]
}

function openHermes(path: string): SyncDatabase | null {
  try {
    if (!hermesPathAllowed(path)) {
      return null
    }
    return new SyncDatabase(path, { readonly: true, fileMustExist: true, timeout: 2000 })
  } catch {
    return null
  }
}

/** Why sync: node:sqlite opens synchronously, so the check before it is too. */
function hermesPathAllowed(path: string): boolean {
  const info = lstatSync(path)
  return info.isFile() && !info.isSymbolicLink() && !isSecretOrSkippedPath(realpathSync(path))
}

type SessionRow = { id: string; title: string | null; last: number; count: number }

function hermesCandidates(path: string): LibraryCandidate[] {
  const db = existsSync(path) ? openHermes(path) : null
  if (!db) {
    return []
  }
  try {
    const sessions = db
      .prepare(
        `SELECT m.session_id AS id, s.title AS title, MAX(m.timestamp) AS last, COUNT(*) AS count
         FROM messages m LEFT JOIN sessions s ON s.id = m.session_id
         WHERE m.role IN ('user', 'assistant') AND m.content IS NOT NULL AND m.content != ''
         GROUP BY m.session_id`
      )
      .all() as SessionRow[]
    return sessions.map((session) => ({
      key: `adam:hermes:${session.id}`,
      source: 'adam' as const,
      path: `${path}#${session.id}`,
      mtimeMs: Number(session.last) * 1000,
      size: Number(session.count),
      load: async () => readHermesSession(path, session.id, session.title)
    }))
  } finally {
    db.close()
  }
}

export function readHermesSession(
  path: string,
  sessionId: string,
  title: string | null
): LibraryDocument | null {
  const db = openHermes(path)
  if (!db) {
    return null
  }
  try {
    const rows = db
      .prepare(
        `SELECT role, substr(content, 1, ?) AS content, timestamp FROM messages
         WHERE session_id = ? AND role IN ('user', 'assistant')
           AND content IS NOT NULL AND content != ''
         ORDER BY id`
      )
      .iterate(DOCUMENT_MAX_CHARS, sessionId) as Iterable<{ role: string; content: string; timestamp: number }>
    const recent = new RecentSections()
    let firstUser = ''
    for (const row of rows) {
      firstUser ||= row.role === 'user' ? row.content : ''
      recent.push({
        text: `${row.role === 'user' ? 'Carson' : 'ADAM'}: ${row.content.trim()}`,
        at: Number(row.timestamp) * 1000
      })
    }
    const sections = recent.sections
    return {
      project: 'ADAM',
      title: title?.trim() || titleFrom(firstUser, 'ADAM session'),
      sections
    }
  } finally {
    db.close()
  }
}

export function adamIngester(paths: AdamPaths): LibraryIngester {
  return {
    source: 'adam',
    list: async () => [
      ...(await threadCandidate(paths.threadFile)),
      ...hermesCandidates(paths.hermesStateDb)
    ]
  }
}
