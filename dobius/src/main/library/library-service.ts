// The library in the running app: one index file in userData, refreshed two
// minutes after start and then every 30 minutes, never two passes at once.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getUserDataRoot } from '../storage/user-data-root'
import { refreshLibrary } from './library-indexer'
import { searchLibrary, sourceCounts } from './library-search'
import { LibraryStore } from './library-store'
import {
  LIBRARY_DEFAULT_CAP_BYTES,
  type LibraryHit,
  type LibraryIngester,
  type LibraryRefreshReport,
  type LibrarySearchQuery,
  type LibraryStatus
} from './library-types'
import { adamIngester } from './sources/adam'
import { claudeConversationsIngester } from './sources/claude-conversations'
import { codexConversationsIngester } from './sources/codex-conversations'
import { obsidianIngester } from './sources/obsidian'
import { projectDocsIngester } from './sources/project-docs'

export const LIBRARY_FIRST_REFRESH_DELAY_MS = 2 * 60 * 1000
export const LIBRARY_REFRESH_INTERVAL_MS = 30 * 60 * 1000

export type LibraryRoots = {
  projectsRoot: string
  claudeProjectsDir: string
  codexSessionsDir: string
  adamThreadFile: string
  hermesStateDb: string
  obsidianVault: string
}

export function defaultLibraryRoots(home = homedir(), userData = getUserDataRoot()): LibraryRoots {
  return {
    projectsRoot: join(home, 'Projects (Code)'),
    claudeProjectsDir: join(home, '.claude', 'projects'),
    codexSessionsDir: join(home, '.codex', 'sessions'),
    adamThreadFile: join(userData, 'adam-thread.json'),
    hermesStateDb: join(home, '.hermes', 'profiles', 'adam', 'state.db'),
    obsidianVault: join(home, 'Obsidian Vault')
  }
}

export function libraryIngesters(roots: LibraryRoots): LibraryIngester[] {
  return [
    projectDocsIngester(roots.projectsRoot),
    claudeConversationsIngester(roots.claudeProjectsDir, roots.projectsRoot),
    codexConversationsIngester(roots.codexSessionsDir, roots.projectsRoot),
    adamIngester({ threadFile: roots.adamThreadFile, hermesStateDb: roots.hermesStateDb }),
    obsidianIngester(roots.obsidianVault)
  ]
}

export class LibraryService {
  private store: LibraryStore | null = null
  private running: Promise<LibraryRefreshReport> | null = null
  private stopped = false
  private timers: NodeJS.Timeout[] = []

  constructor(
    private readonly dbPath: string,
    private readonly ingesters: LibraryIngester[],
    private readonly capBytes = LIBRARY_DEFAULT_CAP_BYTES
  ) {}

  private open(): LibraryStore {
    this.store ??= new LibraryStore(this.dbPath)
    return this.store
  }

  /** One incremental pass; a call while a pass runs gets that pass. */
  refresh(): Promise<LibraryRefreshReport> {
    this.running ??= refreshLibrary(this.open(), this.ingesters, {
      capBytes: this.capBytes,
      shouldStop: () => this.stopped
    }).finally(() => {
      this.running = null
    })
    return this.running
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
    this.stopped = true
    for (const timer of this.timers) {
      clearTimeout(timer)
    }
    this.timers = []
    await this.running?.catch(() => undefined)
    this.store?.close()
    this.store = null
  }
}

let service: LibraryService | null = null

/** The app's library; opened on first use. */
export function getLibraryService(): LibraryService {
  service ??= new LibraryService(
    join(getUserDataRoot(), 'library.sqlite'),
    libraryIngesters(defaultLibraryRoots())
  )
  return service
}

/** Schedule refreshes. Why skipped under e2e: a test copy must not read Carson's files. */
export function startLibraryRefresh(env: NodeJS.ProcessEnv = process.env): void {
  if (env.DOBIUS_E2E_USER_DATA_DIR || env.DOBIUS_LIBRARY_DISABLED === '1') {
    return
  }
  getLibraryService().start()
}

export function stopLibraryRefresh(): void {
  void service?.stop()
}
