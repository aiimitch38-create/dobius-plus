// One incremental pass over every source. Newest first, so when the size cap
// is reached what stays is the recent material and the oldest goes. Runs in
// the refresh worker (library-refresh-worker.ts), never on Electron's main
// thread; it still yields between batches so a stop request is seen quickly.
import { statfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import { classifyDocument } from './library-classify'
import { cleanDocument } from './library-clean'
import { agedWorkDocs, COMPACT_AFTER_MS, compactStoredDoc, compactText, nextShrinkStep } from './library-compact'
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

/**
 * Compact or evict, in the order of nextShrinkStep, until under the cap. Why
 * reclaim before evicting: deleted chunks stay in the FTS segments as
 * tombstones until a merge, so right after compacting the pages still look
 * full; without it a fixture evicted every compacted doc and ended at 1 MB
 * against a 400 kB cap, where the reclaimed file needed 53 kB.
 */
function enforceCap(store: LibraryStore, capBytes: number, report: LibraryRefreshReport): void {
  const pageCap = capBytes - walReserve(capBytes)
  // Why a threshold: a reclaim per eviction made a 60 MiB pass run past 10 minutes.
  const reclaimAt = Math.max(64 * 1024, Math.floor(capBytes / 50))
  let shrunk = false
  while (store.pageBytes() > pageCap) {
    const step = nextShrinkStep(store)
    if (!step || (step.action === 'evict' && store.tombstoneBytes >= reclaimAt)) {
      if (store.tombstoneBytes === 0) {
        break
      }
      store.reclaimIndex()
      continue
    }
    if (step.action === 'compact') {
      compactStoredDoc(store, step.id)
      report.compacted += 1
      shrunk = true
      continue
    }
    store.evictDoc(step.id)
    report.evicted += 1
    shrunk = true
  }
  if (shrunk) {
    store.mergeIndex()
  }
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
    compacted: 0,
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
  const loaded = await candidate.load()
  const kind = loaded ? classifyDocument(candidate.source, loaded) : 'chat'
  const doc = loaded ? cleanDocument(loaded) : { title: '', project: null, chunks: [], dropped: 0 }
  // Why at read time: an old work conversation is written short once, not full then cut.
  const compacted = kind.startsWith('work-') && candidate.mtimeMs < Date.now() - COMPACT_AFTER_MS
  if (compacted && doc.chunks.length > 0) {
    const text = compactText(doc.title, doc.chunks.map((chunk) => chunk.text))
    doc.chunks = [{ text, at: candidate.mtimeMs }]
    report.compacted += 1
  }
  const textBytes = doc.chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.text), 0)
  if (await pass.lowDisk(textBytes * WRITE_FACTOR)) {
    return false
  }
  report.droppedChunks += doc.dropped
  const docId = store.beginDoc({ ...meta, project: doc.project, title: doc.title, kind, compacted })
  for (let i = 0; i < doc.chunks.length; i += CHUNK_BATCH) {
    store.addChunks(docId, doc.title, doc.chunks.slice(i, i + CHUNK_BATCH))
    await pass.yieldNow()
  }
  store.finishDoc(docId, candidate.mtimeMs)
  store.checkpointPassive()
  report.indexed += 1
  // Why every document is read: a smaller older one may still fit after a
  // bigger newer one was evicted, so only an evaluated document is marked.
  enforceCap(store, pass.options.capBytes, report)
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
  try {
    for (const docId of agedWorkDocs(store, Date.now() - COMPACT_AFTER_MS)) {
      compactStoredDoc(store, docId)
      report.compacted += 1
      await pass.yieldNow()
    }
  } catch (error) {
    report.errors.push(`compacting old work: ${errorText(error)}`)
  }
  // Why once more: compaction and the last markers can leave the file over the cap.
  enforceCap(store, options.capBytes, report)
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
