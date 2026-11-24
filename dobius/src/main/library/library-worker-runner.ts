// Starts one refresh pass in a worker thread and hands back its report.
import { Worker } from 'node:worker_threads'
import { app } from 'electron'
import { join } from 'node:path'
import type { LibraryRefreshJob, LibraryWorkerReply } from './library-refresh-job'
import type { RunningPass } from './library-service'
import type { LibraryRefreshReport } from './library-types'

const STOP_GRACE_MS = 5000

function workerPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar', 'out', 'main', 'library-refresh-worker.js')
  }
  return join(__dirname, 'library-refresh-worker.js')
}

/** A pass in its own thread with its own SQLite connection; main only waits. */
export function runPassInWorker(job: LibraryRefreshJob, path = workerPath()): RunningPass {
  const worker = new Worker(path, { workerData: job })
  const done = new Promise<LibraryRefreshReport>((resolve, reject) => {
    worker.once('message', (reply: LibraryWorkerReply) => {
      if (reply.ok) {
        resolve(reply.report)
      } else {
        reject(new Error(reply.error))
      }
      void worker.terminate()
    })
    worker.once('error', reject)
    worker.once('exit', (code) => reject(new Error(`Library refresh worker exited (${code})`)))
  })
  return {
    done,
    stop: () => {
      worker.postMessage('stop')
      // Why terminate after a grace period: a stuck read must not hold quit.
      // Every write is a small transaction, so a cut-off pass loses nothing.
      setTimeout(() => void worker.terminate(), STOP_GRACE_MS).unref()
    }
  }
}
