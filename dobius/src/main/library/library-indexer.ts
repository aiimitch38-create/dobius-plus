// One incremental pass over every source. Newest first, so when the size cap
// is reached what stays is the recent material and the oldest goes. Yields to
// the event loop between documents so the main process never stalls.
import { chunkSections } from './library-chunk'
import { scrubForIndex } from './library-secrets'
import type { LibraryStore } from './library-store'
import type {
  LibraryCandidate,
  LibraryIngester,
  LibraryRefreshReport,
  LibrarySection,
  LibrarySource
} from './library-types'

export type RefreshOptions = {
  capBytes: number
  /** Resolves between documents; the default gives the event loop a turn. */
  yieldNow?: () => Promise<void>
  shouldStop?: () => boolean
}

const defaultYield = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Chunks fit to store: secret-filtered, mostly-secret chunks dropped. */
export function cleanChunks(sections: LibrarySection[]): { chunks: LibrarySection[]; dropped: number } {
  const chunks: LibrarySection[] = []
  let dropped = 0
  for (const chunk of chunkSections(sections)) {
    const text = scrubForIndex(chunk.text)
    if (text === null) {
      dropped += 1
    } else {
      chunks.push({ text, at: chunk.at })
    }
  }
  return { chunks, dropped }
}

function unchanged(store: LibraryStore, candidate: LibraryCandidate): boolean {
  const doc = store.getDoc(candidate.key)
  return doc !== null && doc.mtimeMs === Math.round(candidate.mtimeMs) && doc.size === candidate.size
}

/** Evict oldest documents until under the cap. True when `justAdded` itself went. */
function enforceCap(store: LibraryStore, capBytes: number, justAdded: number | null, report: LibraryRefreshReport): boolean {
  let removedJustAdded = false
  while (store.usedBytes() > capBytes) {
    const oldest = store.oldestLiveDoc()
    if (!oldest) {
      break
    }
    store.evictDoc(oldest.id)
    report.evicted += 1
    if (oldest.id === justAdded) {
      removedJustAdded = true
    }
  }
  return removedJustAdded
}

export async function refreshLibrary(
  store: LibraryStore,
  ingesters: LibraryIngester[],
  options: RefreshOptions
): Promise<LibraryRefreshReport> {
  const started = Date.now()
  const yieldNow = options.yieldNow ?? defaultYield
  const report: LibraryRefreshReport = {
    startedAt: new Date(started).toISOString(),
    finishedAt: '',
    durationMs: 0,
    indexed: 0,
    unchanged: 0,
    removed: 0,
    evicted: 0,
    droppedChunks: 0,
    errors: []
  }
  const candidates: LibraryCandidate[] = []
  const listed = new Set<LibrarySource>()
  for (const ingester of ingesters) {
    try {
      candidates.push(...(await ingester.list()))
      listed.add(ingester.source)
    } catch (error) {
      report.errors.push(`${ingester.source}: ${errorText(error)}`)
    }
    await yieldNow()
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)

  // Why: once a document had to be evicted right after it went in, everything
  // older would go the same way, so it is only marked, never read.
  let floorMs = -Infinity
  for (const candidate of candidates) {
    if (options.shouldStop?.()) {
      break
    }
    if (unchanged(store, candidate)) {
      report.unchanged += 1
      continue
    }
    const meta = {
      key: candidate.key,
      source: candidate.source,
      path: candidate.path,
      mtimeMs: candidate.mtimeMs,
      size: candidate.size
    }
    if (candidate.mtimeMs <= floorMs) {
      store.putDoc({ ...meta, project: null, title: '' }, [], true)
      continue
    }
    try {
      const doc = await candidate.load()
      const { chunks, dropped } = doc ? cleanChunks(doc.sections) : { chunks: [], dropped: 0 }
      report.droppedChunks += dropped
      const docId = store.putDoc(
        { ...meta, project: doc?.project ?? null, title: doc?.title ?? '' },
        chunks
      )
      report.indexed += 1
      if (enforceCap(store, options.capBytes, docId, report)) {
        floorMs = candidate.mtimeMs
      }
    } catch (error) {
      report.errors.push(`${candidate.source} ${candidate.path}: ${errorText(error)}`)
    }
    await yieldNow()
  }

  const seen = new Set(candidates.map((candidate) => candidate.key))
  for (const source of listed) {
    for (const key of store.listKeys(source)) {
      if (!seen.has(key)) {
        store.removeDoc(key)
        report.removed += 1
      }
    }
  }
  store.compact()
  report.finishedAt = new Date().toISOString()
  report.durationMs = Date.now() - started
  store.setMeta('lastRefresh', JSON.stringify(report))
  return report
}
