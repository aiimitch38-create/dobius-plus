// The library: one local full-text index of Carson's projects, conversations
// and notes, so ADAM and the voice layer can look things up without asking a
// busy agent. Text only, on this Mac only.

export const LIBRARY_SOURCES = ['project', 'claude', 'codex', 'adam', 'obsidian'] as const
export type LibrarySource = (typeof LIBRARY_SOURCES)[number]

/** One block of text with the time it was written (ms since epoch). */
export type LibrarySection = { text: string; at: number }

export type LibraryDocument = {
  project: string | null
  title: string
  sections: LibrarySection[]
}

/**
 * Something an ingester found. Listing is cheap (a stat or one query); the
 * text is read only through load(), and only when mtime or size changed.
 */
export type LibraryCandidate = {
  key: string
  source: LibrarySource
  path: string
  mtimeMs: number
  size: number
  load: () => Promise<LibraryDocument | null>
}

export type LibraryIngester = {
  source: LibrarySource
  list: () => Promise<LibraryCandidate[]>
}

export type LibraryHit = {
  source: LibrarySource
  project: string | null
  title: string
  path: string
  /** ISO time of the matching passage. */
  when: string
  snippet: string
}

export type LibrarySearchQuery = {
  query: string
  project?: string
  source?: LibrarySource
  limit?: number
}

export type LibraryRefreshReport = {
  startedAt: string
  finishedAt: string
  durationMs: number
  indexed: number
  unchanged: number
  removed: number
  evicted: number
  droppedChunks: number
  /** Why the pass ended early (low disk, disk full, quit), or null when it finished. */
  stopped: string | null
  errors: string[]
}

export type LibrarySourceStatus = {
  source: LibrarySource
  documents: number
  chunks: number
  textBytes: number
}

export type LibraryStatus = {
  fullTextSearch: boolean
  sizeBytes: number
  capBytes: number
  refreshing: boolean
  lastRefresh: LibraryRefreshReport | null
  sources: LibrarySourceStatus[]
}

export const LIBRARY_DEFAULT_CAP_BYTES = 400 * 1024 * 1024
export const LIBRARY_MAX_RESULTS = 20
export const LIBRARY_SNIPPET_CHARS = 300
