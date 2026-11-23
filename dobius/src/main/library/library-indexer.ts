// One incremental pass over every source. Newest first, so when the size cap
// is reached what stays is the recent material and the oldest goes. Runs in
// the refresh worker (library-refresh-worker.ts), never on Electron's main
// thread; it still yields between batches so a stop request is seen quickly.
import { statfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import { cleanDocument } from './library-clean'
import { docKeyId } from './library-schema'
import type { LibraryStore } from './library-store'
import { WAL_SIZE_LIMIT } from './library-store'
import { scrubText } from './library-secrets'
import type {
  LibraryCandidate,
  LibraryIngester,
  LibraryRefreshReport,
  LibrarySource
} from './library-types'

export const MIN_FREE_DISK_BYTES = 2 * 1024 * 1024 * 1024
export const CHUNK_BATCH = 100
/** Index bytes written per byte of text (rows, FTS index, WAL); measured near 1.9. */
const WRITE_FACTOR = 3

export type RefreshOptions = {
  capBytes: number
  /** Resolves between batches; the default gives the event loop a turn. */
  yieldNow?: () => Promise<void>
  shouldStop?: () => boolean
  /** Free bytes on the index's disk; defaults to statfs on its folder. */
  freeBytes?: () => Promise<number>
  minFreeBytes?: number
}

type Listing = { candidates: LibraryCandidate[]; listed: Set<LibrarySource> }

const defaultYield = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isDiskFull(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'ENOSPC' || /SQLITE_FULL|disk is full|ENOSPC/i.test(errorText(error))
}

function unchanged(store: LibraryStore, candidate: LibraryCandidate): boolean {
  const doc = store.getDoc(candidate.key)
  return doc !== null && doc.mtimeMs === Math.round(candidate.mtimeMs) && doc.size === candidate.size
}

/**
 * Room kept for the WAL inside the cap. Why not checkpoint here: a TRUNCATE
 * checkpoint briefly locks out readers, and main's searches waited ~95 ms on
 * it. journal_size_limit keeps the WAL near this size instead.
 */
export function walReserve(capBytes: number): number {
  return Math.min(WAL_SIZE_LIMIT, Math.floor(capBytes / 4))
}

/** Evict oldest documents until under the cap. True when `justAdded` itself went. */
function enforceCap(
  store: LibraryStore,
  capBytes: number,
  justAdded: number,
  report: LibraryRefreshReport
): boolean {
  const pageCap = capBytes - walReserve(capBytes)
  const evictedBefore = report.evicted
  let removedJustAdded = false
  while (store.pageBytes() > pageCap) {
    const oldest = store.oldestLiveDoc()
    if (!oldest) {
      break
    }
    store.evictDoc(oldest.id)
    report.evicted += 1
    removedJustAdded ||= oldest.id === justAdded
  }
  if (report.evicted > evictedBefore) {
    store.mergeIndex()
  }
  return removedJustAdded
}

function emptyReport(started: number): LibraryRefreshReport {
  return {
    startedAt: new Date(started).toISOString(),
    finishedAt: '',
    durationMs: 0,
    indexed: 0,
    unchanged: 0,
    removed: 0,
    evicted: 0,
    droppedChunks: 0,
    stopped: null,
    errors: []
  }
}

async function listAll(
  ingesters: LibraryIngester[],
  report: LibraryRefreshReport,
  yieldNow: () => Promise<void>
): Promise<Listing> {
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
  return { candidates, listed }
}

type Pass = {
  store: LibraryStore
  options: RefreshOptions
  report: LibraryRefreshReport
  yieldNow: () => Promise<void>
  lowDisk: (needed: number) => Promise<boolean>
  floorMs: number
}

/** Index one candidate. False means stop the pass (low disk or disk full). */
async function indexOne(pass: Pass, candidate: LibraryCandidate): Promise<boolean> {
  const { store, report } = pass
  const meta = {
    key: candidate.key,
    source: candidate.source,
    path: scrubText(candidate.path).text,
    mtimeMs: candidate.mtimeMs,
    size: candidate.size
  }
  if (candidate.mtimeMs <= pass.floorMs) {
    store.putDoc({ ...meta, project: null, title: '' }, [], true)
    return true
  }
  const loaded = await candidate.load()
  const doc = loaded ? cleanDocument(loaded) : { title: '', project: null, chunks: [], dropped: 0 }
  const textBytes = doc.chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.text), 0)
  if (await pass.lowDisk(textBytes * WRITE_FACTOR)) {
    return false
  }
  report.droppedChunks += doc.dropped
  const docId = store.beginDoc({ ...meta, project: doc.project, title: doc.title })
  for (let i = 0; i < doc.chunks.length; i += CHUNK_BATCH) {
    store.addChunks(docId, doc.title, doc.chunks.slice(i, i + CHUNK_BATCH))
    await pass.yieldNow()
  }
  store.finishDoc(docId, candidate.mtimeMs)
  store.checkpointPassive()
  report.indexed += 1
  // Why: once a document is evicted right after it went in, everything older
  // would go the same way, so the rest is only marked, never read.
  if (enforceCap(store, pass.options.capBytes, docId, report)) {
    pass.floorMs = candidate.mtimeMs
  }
  return true
}

export async function refreshLibrary(
  store: LibraryStore,
  ingesters: LibraryIngester[],
  options: RefreshOptions
): Promise<LibraryRefreshReport> {
  const started = Date.now()
  const freeBytes =
    options.freeBytes ??
    (async () => {
      const info = await statfs(dirname(store.path))
      return Number(info.bavail) * Number(info.bsize)
    })
  const minFree = options.minFreeBytes ?? MIN_FREE_DISK_BYTES
  const report = emptyReport(started)
  const pass: Pass = {
    store,
    options,
    report,
    yieldNow: options.yieldNow ?? defaultYield,
    floorMs: -Infinity,
    lowDisk: async (needed) => {
      if ((await freeBytes()) - needed >= minFree) {
        return false
      }
      report.stopped = `less than ${Math.round(minFree / 1024 ** 3)} GB of disk would be left free`
      return true
    }
  }
  if (await pass.lowDisk(0)) {
    return finish(store, report, started, null)
  }
  const listing = await listAll(ingesters, report, pass.yieldNow)
  for (const candidate of listing.candidates) {
    if (options.shouldStop?.()) {
      report.stopped = 'the app asked the refresh to stop'
      return finish(store, report, started, null)
    }
    if (unchanged(store, candidate)) {
      report.unchanged += 1
      continue
    }
    try {
      if (!(await indexOne(pass, candidate))) {
        return finish(store, report, started, null)
      }
    } catch (error) {
      if (isDiskFull(error)) {
        // Every write is its own small transaction, so SQLite rolled this one back.
        report.stopped = 'the disk is full'
        return finish(store, report, started, null)
      }
      report.errors.push(`${candidate.source} ${candidate.path}: ${errorText(error)}`)
    }
    await pass.yieldNow()
  }
  // Why once more: compaction and the last markers can leave the file over the cap.
  enforceCap(store, options.capBytes, -1, report)
  return finish(store, report, started, listing)
}

function finish(
  store: LibraryStore,
  report: LibraryRefreshReport,
  started: number,
  full: Listing | null
): LibraryRefreshReport {
  try {
    // Why only after a full pass: a stopped pass did not look at every file.
    if (full) {
      const seen = new Set(full.candidates.map((candidate) => docKeyId(candidate.key)))
      for (const source of full.listed) {
        for (const keyId of store.listKeyIds(source)) {
          if (!seen.has(keyId)) {
            store.removeDocByKeyId(keyId)
            report.removed += 1
          }
        }
      }
    }
    store.compact()
  } catch (error) {
    report.errors.push(`cleanup: ${errorText(error)}`)
  }
  report.finishedAt = new Date().toISOString()
  report.durationMs = Date.now() - started
  try {
    store.setMeta('lastRefresh', JSON.stringify(report))
  } catch (error) {
    report.errors.push(`saving the report: ${errorText(error)}`)
  }
  return report
}
