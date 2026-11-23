// The app's one library: userData/library.sqlite, refreshed in a worker.
import { join } from 'node:path'
import { getUserDataRoot } from '../storage/user-data-root'
import { defaultLibraryRoots } from './library-roots'
import { LibraryService } from './library-service'
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
