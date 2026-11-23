// The library in the running app: search and status read the index on the
// main thread (WAL lets them read while a pass writes); refresh passes run
// through a PassRunner (a worker thread in the app), two minutes after start
// and then every 30 minutes, never two at once.
import type { LibraryRefreshJob } from './library-refresh-job'
import type { LibraryRoots } from './library-roots'
import { searchLibrary, sourceCounts } from './library-search'
import { LibraryStore } from './library-store'
import type {
  LibraryHit,
  LibraryRefreshReport,
  LibrarySearchQuery,
  LibraryStatus
} from './library-types'
import { LIBRARY_DEFAULT_CAP_BYTES } from './library-types'

export const LIBRARY_FIRST_REFRESH_DELAY_MS = 2 * 60 * 1000
export const LIBRARY_REFRESH_INTERVAL_MS = 30 * 60 * 1000
/** How long quit waits for a running pass to stop (the worker is terminated at 5 s). */
export const LIBRARY_STOP_WAIT_MS = 5500

export type RunningPass = { done: Promise<LibraryRefreshReport>; stop: () => void }
export type PassRunner = (job: LibraryRefreshJob) => RunningPass

export class LibraryService {
  private store: LibraryStore | null = null
  private running: RunningPass | null = null
  private timers: NodeJS.Timeout[] = []

  constructor(
    private readonly dbPath: string,
    private readonly roots: LibraryRoots,
    private readonly runPass: PassRunner,
    private readonly capBytes = LIBRARY_DEFAULT_CAP_BYTES
  ) {}

  private open(): LibraryStore {
    this.store ??= new LibraryStore(this.dbPath)
    return this.store
  }

  /** One incremental pass; a call while a pass runs gets that pass. */
  refresh(): Promise<LibraryRefreshReport> {
    if (!this.running) {
      const pass = this.runPass({ dbPath: this.dbPath, roots: this.roots, capBytes: this.capBytes })
      this.running = pass
      void pass.done.then(
        () => this.clear(pass),
        () => this.clear(pass)
      )
    }
    return this.running.done
  }

  private clear(pass: RunningPass): void {
    if (this.running === pass) {
      this.running = null
    }
  }

  search(query: LibrarySearchQuery): LibraryHit[] {
    return searchLibrary(this.open(), query)
  }

  status(): LibraryStatus {
    const store = this.open()
    const last = store.getMeta('lastRefresh')
    return {
      fullTextSearch: store.fts,
      sizeBytes: store.fileBytes(),
      capBytes: this.capBytes,
      refreshing: this.running !== null,
      lastRefresh: last ? (JSON.parse(last) as LibraryRefreshReport) : null,
      sources: sourceCounts(store)
    }
  }

  start(): void {
    const run = (): void => {
      this.refresh().catch((error: unknown) => console.warn('Library refresh failed:', error))
    }
    const first = setTimeout(() => {
      run()
      const every = setInterval(run, LIBRARY_REFRESH_INTERVAL_MS)
      every.unref()
      this.timers.push(every)
    }, LIBRARY_FIRST_REFRESH_DELAY_MS)
    first.unref()
    this.timers.push(first)
  }

  async stop(): Promise<void> {
    for (const timer of this.timers) {
      clearTimeout(timer)
    }
    this.timers = []
    const pass = this.running
    if (pass) {
      pass.stop()
      // Why a cap: quit must not hang on a stuck pass; the runner terminates it at 5 s.
      let timer: NodeJS.Timeout | undefined
      await Promise.race([
        pass.done.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, LIBRARY_STOP_WAIT_MS)
        })
      ])
      clearTimeout(timer)
    }
    this.store?.close()
    this.store = null
  }
}
