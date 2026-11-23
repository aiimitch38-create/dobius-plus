// Worker thread entry (built as out/main/library-refresh-worker.js). Why a
// worker: reading transcripts and writing the FTS index took hundreds of
// milliseconds per large document on Electron's main thread.
import { parentPort, workerData } from 'node:worker_threads'
import type { LibraryRefreshJob, LibraryWorkerReply } from './library-refresh-job'
import { runRefreshJob } from './library-refresh-job'

if (!parentPort) {
  throw new Error('The library refresh worker must run with a parent port.')
}
const port = parentPort
let stopRequested = false
port.on('message', (message: unknown) => {
  if (message === 'stop') {
    stopRequested = true
  }
})

runRefreshJob(workerData as LibraryRefreshJob, () => stopRequested).then(
  (report) => port.postMessage({ ok: true, report } satisfies LibraryWorkerReply),
  (error: unknown) =>
    port.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    } satisfies LibraryWorkerReply)
)
