// One refresh pass with its own SQLite connection. Runs inside the refresh
// worker thread; tests call it directly.
import { refreshLibrary } from './library-indexer'
import type { LibraryRoots } from './library-roots'
import { libraryIngesters } from './library-roots'
import { LibraryStore } from './library-store'
import type { LibraryRefreshReport } from './library-types'

export type LibraryRefreshJob = {
  dbPath: string
  roots: LibraryRoots
  capBytes: number
}

export type LibraryWorkerReply =
  | { ok: true; report: LibraryRefreshReport }
  | { ok: false; error: string }

export async function runRefreshJob(
  job: LibraryRefreshJob,
  shouldStop: () => boolean,
  freeBytes?: () => Promise<number>
): Promise<LibraryRefreshReport> {
  const store = new LibraryStore(job.dbPath)
  try {
    return await refreshLibrary(store, libraryIngesters(job.roots), {
      capBytes: job.capBytes,
      shouldStop,
      freeBytes
    })
  } finally {
    store.close()
  }
}
