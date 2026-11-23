// ADAM: his Dobius thread (userData/adam-thread.json) and his Hermes sessions.
// Hermes keeps transcripts in ~/.hermes/profiles/adam/state.db (`messages`),
// read here read-only. Its sessions/ folder holds only failed-request dumps
// with Authorization headers, so it is never read; nor is ~/.hermes/.env.
import { readFile, stat } from 'node:fs/promises'
import { titleFrom } from '../library-chunk'
import type { LibraryCandidate, LibraryDocument, LibraryIngester } from '../library-types'
import SyncDatabase from '../../sqlite/sync-database'

export type AdamPaths = { threadFile: string; hermesStateDb: string }

async function threadCandidate(file: string): Promise<LibraryCandidate[]> {
  let info
  try {
    info = await stat(file)
  } catch {
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
        const rows: unknown = JSON.parse(await readFile(file, 'utf8'))
        if (!Array.isArray(rows)) {
          return null
        }
        // Why the file time: thread rows carry no timestamps of their own.
        const sections = rows.flatMap((row) => {
          const { role, text } = (row ?? {}) as { role?: unknown; text?: unknown }
          if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string' || !text.trim()) {
            return []
          }
          return [{ text: `${role === 'user' ? 'Carson' : 'ADAM'}: ${text.trim()}`, at: info.mtimeMs }]
        })
        return { project: 'ADAM', title: 'ADAM thread in Dobius+', sections }
      }
    }
  ]
}

function openHermes(path: string): SyncDatabase | null {
  try {
    return new SyncDatabase(path, { readonly: true, fileMustExist: true, timeout: 2000 })
  } catch {
    return null
  }
}

type SessionRow = { id: string; title: string | null; last: number; count: number }

function hermesCandidates(path: string): LibraryCandidate[] {
  const db = openHermes(path)
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
        `SELECT role, content, timestamp FROM messages
         WHERE session_id = ? AND role IN ('user', 'assistant')
           AND content IS NOT NULL AND content != ''
         ORDER BY id`
      )
      .all(sessionId) as { role: string; content: string; timestamp: number }[]
    const sections = rows.map((row) => ({
      text: `${row.role === 'user' ? 'Carson' : 'ADAM'}: ${row.content.trim()}`,
      at: Number(row.timestamp) * 1000
    }))
    const firstUser = rows.find((row) => row.role === 'user')?.content ?? ''
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
