// The app's one library: userData/library.sqlite, refreshed in a worker.
import { join } from 'node:path'
import { getUserDataRoot } from '../storage/user-data-root'
import { defaultLibraryRoots } from './library-roots'
import { LibraryService } from './library-service'
import type { LibraryHit, LibrarySearchQuery } from './library-types'
import { runPassInWorker } from './library-worker-runner'

let service: LibraryService | null = null

/** The app's library; opened on first use. */
export function getLibraryService(): LibraryService {
  const userData = getUserDataRoot()
  service ??= new LibraryService(
    join(userData, 'library.sqlite'),
    defaultLibraryRoots(userData),
    (job) => runPassInWorker(job)
  )
  return service
}

function libraryOff(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.DOBIUS_E2E_USER_DATA_DIR) || env.DOBIUS_LIBRARY_DISABLED === '1'
}

/** Schedule refreshes. Why skipped under e2e: a test copy must not read Carson's files. */
export function startLibraryRefresh(env: NodeJS.ProcessEnv = process.env): void {
  if (libraryOff(env)) {
    return
  }
  getLibraryService().start()
}

/** The live voice's look-up: null when the library is off, not read through yet, or cannot be opened. */
export function lookUpInLibrary(
  query: LibrarySearchQuery,
  env: NodeJS.ProcessEnv = process.env
): LibraryHit[] | null {
  if (libraryOff(env)) {
    return null
  }
  try {
    return getLibraryService().lookUp(query)
  } catch (error) {
    console.warn('Library look-up failed:', error)
    return null
  }
}

/** Resolves once a running pass has stopped (at most about 5.5 s). */
export function stopLibraryRefresh(): Promise<void> {
  return service?.stop() ?? Promise.resolve()
}
