import type { DocClass } from './library-classify'
import { DOC_CLASSES } from './library-classify'
import { scrubSnippet } from './library-secrets'
import type { LibraryStore } from './library-store'
import {
  LIBRARY_MAX_RESULTS,
  LIBRARY_SNIPPET_CHARS,
  LIBRARY_SOURCES,
  type LibraryHit,
  type LibrarySearchQuery,
  type LibrarySource,
  type LibrarySourceStatus,
  type LibraryStatus
} from './library-types'

type HitRow = {
  source: LibrarySource
  project: string | null
  title: string
  path: string
  at_ms: number
  doc_id: number
  snip: string
}

/** Words of a free-text query, safe to quote into an FTS5 MATCH. */
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []
  return [...new Set(words)].slice(0, 12)
}

function ftsMatch(terms: string[], joiner: 'AND' | 'OR'): string {
  return terms.map((term) => `"${term}"`).join(` ${joiner} `)
}

function filters(params: LibrarySearchQuery): { sql: string; args: string[] } {
  const parts: string[] = []
  const args: string[] = []
  if (params.source) {
    parts.push('d.source = ?')
    args.push(params.source)
  }
  if (params.project) {
    // Why a contains match: a spoken "epoxy" should find "epoxyitright".
    parts.push("d.project LIKE ? ESCAPE '\\'")
    args.push(`%${params.project.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
  }
  return { sql: parts.map((part) => ` AND ${part}`).join(''), args }
}

function ftsRows(store: LibraryStore, match: string, params: LibrarySearchQuery, take: number): HitRow[] {
  const filter = filters(params)
  return store.db
    .prepare(
      `SELECT d.source, d.project, d.title, d.path, c.at_ms, c.doc_id,
              snippet(chunks_fts, 1, '', '', '…', 40) AS snip
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid
       JOIN docs d ON d.id = c.doc_id
       WHERE chunks_fts MATCH ?${filter.sql}
       ORDER BY bm25(chunks_fts, 3.0, 1.0)
       LIMIT ?`
    )
    .all(match, ...filter.args, take) as HitRow[]
}

function windowAround(text: string, term: string): string {
  const index = text.toLowerCase().indexOf(term)
  const start = Math.max(0, index - 120)
  return `${start > 0 ? '…' : ''}${text.slice(start, start + LIBRARY_SNIPPET_CHARS)}`
}

/** Fallback when the bundled SQLite has no FTS5: every word must appear, newest first. */
function likeRows(store: LibraryStore, terms: string[], params: LibrarySearchQuery, take: number): HitRow[] {
  const filter = filters(params)
  const likes = terms.map(() => "c.text LIKE ? ESCAPE '\\'").join(' AND ')
  const rows = store.db
    .prepare(
      `SELECT d.source, d.project, d.title, d.path, c.at_ms, c.doc_id, c.text AS snip
       FROM chunks c JOIN docs d ON d.id = c.doc_id
       WHERE ${likes}${filter.sql}
       ORDER BY c.at_ms DESC LIMIT ?`
    )
    .all(
      ...terms.map((term) => `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`),
      ...filter.args,
      take
    ) as HitRow[]
  return rows.map((row) => ({ ...row, snip: windowAround(row.snip, terms[0]) }))
}

/** The best passage per document, ranked by BM25 (title weighted 3x). */
export function searchLibrary(store: LibraryStore, params: LibrarySearchQuery): LibraryHit[] {
  const terms = queryTerms(params.query)
  if (terms.length === 0) {
    return []
  }
  const limit = Math.min(Math.max(params.limit ?? 8, 1), LIBRARY_MAX_RESULTS)
  const take = limit * 4
  let rows: HitRow[]
  if (store.fts) {
    rows = ftsRows(store, ftsMatch(terms, 'AND'), params, take)
    // Why: a spoken question rarely has every word in one passage.
    if (rows.length === 0 && terms.length > 1) {
      rows = ftsRows(store, ftsMatch(terms, 'OR'), params, take)
    }
  } else {
    rows = likeRows(store, terms, params, take)
  }
  const seen = new Set<number>()
  const hits: LibraryHit[] = []
  for (const row of rows) {
    if (seen.has(row.doc_id)) {
      continue
    }
    seen.add(row.doc_id)
    hits.push({
      source: row.source,
      project: row.project,
      title: scrubSnippet(row.title, 120),
      path: row.path,
      when: new Date(row.at_ms).toISOString(),
      snippet: scrubSnippet(row.snip, LIBRARY_SNIPPET_CHARS)
    })
    if (hits.length >= limit) {
      break
    }
  }
  return hits
}

export function sourceCounts(store: LibraryStore): LibrarySourceStatus[] {
  const rows = store.db
    .prepare(
      `SELECT d.source AS source, COUNT(DISTINCT d.id) AS documents,
              COUNT(c.id) AS chunks, COALESCE(SUM(LENGTH(c.text)), 0) AS textBytes
       FROM docs d LEFT JOIN chunks c ON c.doc_id = d.id
       WHERE d.evicted = 0 GROUP BY d.source`
    )
    .all() as { source: LibrarySource; documents: number; chunks: number; textBytes: number }[]
  return LIBRARY_SOURCES.map((source) => {
    const row = rows.find((candidate) => candidate.source === source)
    return {
      source,
      documents: Number(row?.documents ?? 0),
      chunks: Number(row?.chunks ?? 0),
      textBytes: Number(row?.textBytes ?? 0)
    }
  })
}

export function classCounts(store: LibraryStore): LibraryStatus['classes'] {
  const rows = store.db
    .prepare(
      'SELECT kind, COUNT(*) AS documents, SUM(compacted) AS compacted FROM docs WHERE evicted = 0 GROUP BY kind'
    )
    .all() as { kind: DocClass; documents: number; compacted: number | null }[]
  return DOC_CLASSES.map((kind) => {
    const row = rows.find((candidate) => candidate.kind === kind)
    return { kind, documents: Number(row?.documents ?? 0), compacted: Number(row?.compacted ?? 0) }
  })
}
